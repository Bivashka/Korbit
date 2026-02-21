import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';
import { createAdapter } from '@socket.io/redis-adapter';
import { UserRole } from '@prisma/client';
import { createClient, RedisClientType } from 'redis';
import { Server, Socket } from 'socket.io';
import { JwtPayload } from '../common/interfaces/jwt-payload.interface';
import { PrismaService } from '../prisma/prisma.service';
import { ReadReceiptDto } from './dto/read-receipt.dto';
import { TypingDto } from './dto/typing.dto';
import { CallOfferDto } from './dto/call/call-offer.dto';
import { CallAnswerDto } from './dto/call/call-answer.dto';
import { CallIceCandidateDto } from './dto/call/call-ice-candidate.dto';
import { CallEndDto } from './dto/call/call-end.dto';

type SocketUser = JwtPayload;

type RealtimeMessageReference = {
  id: string;
  chatId: string;
  senderId: string;
  content: string;
  isDeleted: boolean;
  deletedAt: Date | null;
  editedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  sender: {
    id: string;
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
  };
};

type RealtimeMessagePayload = {
  id: string;
  chatId: string;
  senderId: string;
  content: string;
  isDeleted: boolean;
  deletedAt: Date | null;
  editedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  sender: {
    id: string;
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
  };
  attachments: Array<{
    id: string;
    messageId: string;
    fileName: string;
    mimeType: string;
    size: number;
    url: string;
    createdAt: Date;
  }>;
  reactions: Array<{
    id: string;
    messageId: string;
    userId: string;
    emoji: string;
    createdAt: Date;
    user: {
      id: string;
      username: string;
      displayName: string | null;
      avatarUrl: string | null;
    };
  }>;
  replyToMessage: RealtimeMessageReference | null;
  forwardedFromMessage: RealtimeMessageReference | null;
};

type PendingCallOffer = {
  chatId: string;
  senderId: string;
  type: 'audio' | 'video';
  sdp: Record<string, unknown>;
  createdAt: string;
  expiresAt: number;
};

@WebSocketGateway({
  namespace: '/realtime',
  cors: {
    origin: true,
    credentials: true,
  },
})
export class RealtimeGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(RealtimeGateway.name);
  private readonly userConnectionCount = new Map<string, number>();
  private readonly socketToUser = new Map<string, string>();
  private readonly pendingCallOffers = new Map<string, PendingCallOffer>();
  private pubClient?: RedisClientType;
  private subClient?: RedisClientType;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async afterInit(server: Server) {
    const redisUrl = this.configService.get<string>('REDIS_URL');
    if (!redisUrl) {
      return;
    }

    try {
      this.pubClient = createClient({ url: redisUrl });
      this.subClient = this.pubClient.duplicate();
      await Promise.all([this.pubClient.connect(), this.subClient.connect()]);
      server.adapter(createAdapter(this.pubClient, this.subClient));
      this.logger.log('Socket.IO Redis adapter enabled');
    } catch (error) {
      this.logger.warn(`Redis adapter disabled: ${String(error)}`);
    }
  }

  async handleConnection(client: Socket) {
    try {
      const user = await this.authenticateSocket(client);
      client.data.user = user;
      this.socketToUser.set(client.id, user.sub);

      const userRoom = this.userRoom(user.sub);
      await client.join(userRoom);

      const chatMemberships = await this.prisma.chatMember.findMany({
        where: { userId: user.sub },
        select: { chatId: true },
      });

      await Promise.all(
        chatMemberships.map((membership) =>
          client.join(this.chatRoom(membership.chatId)),
        ),
      );

      const current = this.userConnectionCount.get(user.sub) ?? 0;
      this.userConnectionCount.set(user.sub, current + 1);
      if (current === 0) {
        this.emitPresence(user.sub, 'online');
      }

      const snapshot = Array.from(this.userConnectionCount.entries())
        .filter(([, count]) => count > 0)
        .map(([userId]) => ({ userId, status: 'online' as const }));
      client.emit('presence_snapshot', snapshot);

      this.emitPendingCallOffers(client, user.sub, chatMemberships.map((item) => item.chatId));
    } catch (error) {
      this.logger.warn(`Socket rejected: ${String(error)}`);
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    const userId = this.socketToUser.get(client.id);
    if (!userId) {
      return;
    }

    const current = this.userConnectionCount.get(userId) ?? 0;
    if (current <= 1) {
      this.userConnectionCount.delete(userId);
      this.emitPresence(userId, 'offline');
    } else {
      this.userConnectionCount.set(userId, current - 1);
    }

    for (const [chatId, pendingOffer] of this.pendingCallOffers.entries()) {
      if (pendingOffer.senderId !== userId) {
        continue;
      }
      this.pendingCallOffers.delete(chatId);
      this.server.to(this.chatRoom(chatId)).emit('call_end', {
        chatId,
        senderId: userId,
        at: new Date().toISOString(),
      });
    }

    this.socketToUser.delete(client.id);
  }

  @SubscribeMessage('typing')
  async handleTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: TypingDto,
  ) {
    const user = this.getClientUser(client);
    const hasAccess = await this.isMember(body.chatId, user.sub);
    if (!hasAccess) {
      throw new WsException('Нет доступа к чату');
    }

    const payload = {
      chatId: body.chatId,
      userId: user.sub,
      isTyping: Boolean(body.isTyping),
      at: new Date().toISOString(),
    };

    client.to(this.chatRoom(body.chatId)).emit('typing', payload);
    return payload;
  }

  @SubscribeMessage('read_receipt')
  async handleReadReceipt(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: ReadReceiptDto,
  ) {
    const user = this.getClientUser(client);
    const hasAccess = await this.isMember(body.chatId, user.sub);
    if (!hasAccess) {
      throw new WsException('Нет доступа к чату');
    }

    let messageId = body.messageId;
    if (!messageId) {
      const latest = await this.prisma.message.findFirst({
        where: { chatId: body.chatId },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      messageId = latest?.id;
    }

    if (messageId) {
      const message = await this.prisma.message.findUnique({
        where: { id: messageId },
        select: { chatId: true },
      });
      if (!message || message.chatId !== body.chatId) {
        throw new WsException('Сообщение не относится к этому чату');
      }
    }

    await this.prisma.chatMember.update({
      where: {
        chatId_userId: {
          chatId: body.chatId,
          userId: user.sub,
        },
      },
      data: {
        lastReadMessageId: messageId ?? null,
      },
    });

    const payload = {
      chatId: body.chatId,
      userId: user.sub,
      messageId: messageId ?? null,
      at: new Date().toISOString(),
    };
    this.server.to(this.chatRoom(body.chatId)).emit('read_receipt', payload);
    return payload;
  }

  @SubscribeMessage('call_offer')
  async handleCallOffer(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: CallOfferDto,
  ) {
    const user = this.getClientUser(client);
    const hasAccess = await this.isMember(body.chatId, user.sub);
    if (!hasAccess) {
      throw new WsException('Нет доступа к чату');
    }

    this.cleanupExpiredPendingCallOffers();

    const payload = {
      chatId: body.chatId,
      senderId: user.sub,
      type: body.type,
      sdp: body.sdp,
      renegotiate: Boolean(body.renegotiate),
      at: new Date().toISOString(),
    };

    if (!body.renegotiate) {
      this.pendingCallOffers.set(body.chatId, {
        chatId: body.chatId,
        senderId: user.sub,
        type: body.type,
        sdp: body.sdp,
        createdAt: payload.at,
        expiresAt: Date.now() + 75_000,
      });
    }

    client.to(this.chatRoom(body.chatId)).emit('call_offer', payload);
    return { ok: true };
  }

  @SubscribeMessage('call_answer')
  async handleCallAnswer(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: CallAnswerDto,
  ) {
    const user = this.getClientUser(client);
    const hasAccess = await this.isMember(body.chatId, user.sub);
    if (!hasAccess) {
      throw new WsException('Нет доступа к чату');
    }

    if (!body.renegotiate) {
      this.pendingCallOffers.delete(body.chatId);
    }

    const payload = {
      chatId: body.chatId,
      senderId: user.sub,
      sdp: body.sdp,
      renegotiate: Boolean(body.renegotiate),
      at: new Date().toISOString(),
    };
    client.to(this.chatRoom(body.chatId)).emit('call_answer', payload);
    return { ok: true };
  }

  @SubscribeMessage('call_ice_candidate')
  async handleCallIceCandidate(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: CallIceCandidateDto,
  ) {
    const user = this.getClientUser(client);
    const hasAccess = await this.isMember(body.chatId, user.sub);
    if (!hasAccess) {
      throw new WsException('Нет доступа к чату');
    }

    const payload = {
      chatId: body.chatId,
      senderId: user.sub,
      candidate: body.candidate,
      at: new Date().toISOString(),
    };
    client.to(this.chatRoom(body.chatId)).emit('call_ice_candidate', payload);
    return { ok: true };
  }

  @SubscribeMessage('call_end')
  async handleCallEnd(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: CallEndDto,
  ) {
    const user = this.getClientUser(client);
    const hasAccess = await this.isMember(body.chatId, user.sub);
    if (!hasAccess) {
      throw new WsException('Нет доступа к чату');
    }

    this.pendingCallOffers.delete(body.chatId);

    const payload = {
      chatId: body.chatId,
      senderId: user.sub,
      at: new Date().toISOString(),
    };
    this.server.to(this.chatRoom(body.chatId)).emit('call_end', payload);
    return { ok: true };
  }

  emitNewMessage(chatId: string, message: RealtimeMessagePayload) {
    this.server
      .to(this.chatRoom(chatId))
      .emit('new_message', this.serializeMessagePayload(message));
  }

  emitMessageUpdated(chatId: string, message: RealtimeMessagePayload) {
    this.server
      .to(this.chatRoom(chatId))
      .emit('message_updated', this.serializeMessagePayload(message));
  }

  emitChatPinnedMessage(
    chatId: string,
    pinnedMessage: RealtimeMessageReference | null,
  ) {
    this.server.to(this.chatRoom(chatId)).emit('chat_pinned_message', {
      chatId,
      pinnedMessage: this.serializeMessageReference(pinnedMessage),
      at: new Date().toISOString(),
    });
  }

  emitReadReceipt(
    chatId: string,
    payload: { chatId: string; userId: string; messageId: string | null },
  ) {
    this.server.to(this.chatRoom(chatId)).emit('read_receipt', {
      ...payload,
      at: new Date().toISOString(),
    });
  }

  private emitPresence(userId: string, status: 'online' | 'offline') {
    this.server.emit('presence', {
      userId,
      status,
      at: new Date().toISOString(),
    });
  }

  private serializeMessagePayload(message: RealtimeMessagePayload) {
    return {
      ...message,
      createdAt: message.createdAt.toISOString(),
      updatedAt: message.updatedAt.toISOString(),
      deletedAt: message.deletedAt ? message.deletedAt.toISOString() : null,
      editedAt: message.editedAt ? message.editedAt.toISOString() : null,
      attachments: message.attachments.map((attachment) => ({
        ...attachment,
        createdAt: attachment.createdAt.toISOString(),
      })),
      reactions: message.reactions.map((reaction) => ({
        ...reaction,
        createdAt: reaction.createdAt.toISOString(),
      })),
      replyToMessage: this.serializeMessageReference(message.replyToMessage),
      forwardedFromMessage: this.serializeMessageReference(
        message.forwardedFromMessage,
      ),
    };
  }

  private serializeMessageReference(message: RealtimeMessageReference | null) {
    if (!message) {
      return null;
    }
    return {
      ...message,
      createdAt: message.createdAt.toISOString(),
      updatedAt: message.updatedAt.toISOString(),
      deletedAt: message.deletedAt ? message.deletedAt.toISOString() : null,
      editedAt: message.editedAt ? message.editedAt.toISOString() : null,
    };
  }

  private getClientUser(client: Socket): SocketUser {
    const user = client.data.user as SocketUser | undefined;
    if (!user) {
      throw new WsException('Не авторизован');
    }
    return user;
  }

  private async isMember(chatId: string, userId: string) {
    const membership = await this.prisma.chatMember.findUnique({
      where: {
        chatId_userId: {
          chatId,
          userId,
        },
      },
      select: { id: true },
    });
    return Boolean(membership);
  }

  private async authenticateSocket(client: Socket): Promise<SocketUser> {
    const handshakeToken = client.handshake.auth?.token;
    const authHeader = client.handshake.headers.authorization;
    const bearerToken =
      typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
        ? authHeader.slice(7)
        : undefined;

    const token =
      (typeof handshakeToken === 'string' ? handshakeToken : undefined) ||
      bearerToken;
    if (!token) {
      throw new WsException('Отсутствует токен авторизации');
    }

    const payload = await this.jwtService.verifyAsync<{
      sub: string;
      username: string;
      role: UserRole;
      sessionId: string;
    }>(token, {
      secret: this.configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
    });

    return payload;
  }

  private chatRoom(chatId: string) {
    return `chat:${chatId}`;
  }

  private userRoom(userId: string) {
    return `user:${userId}`;
  }

  private cleanupExpiredPendingCallOffers() {
    const now = Date.now();
    for (const [chatId, offer] of this.pendingCallOffers.entries()) {
      if (offer.expiresAt <= now) {
        this.pendingCallOffers.delete(chatId);
      }
    }
  }

  private emitPendingCallOffers(client: Socket, userId: string, chatIds: string[]) {
    this.cleanupExpiredPendingCallOffers();
    const chatIdSet = new Set(chatIds);
    for (const offer of this.pendingCallOffers.values()) {
      if (offer.senderId === userId) {
        continue;
      }
      if (!chatIdSet.has(offer.chatId)) {
        continue;
      }
      if (!this.userConnectionCount.get(offer.senderId)) {
        continue;
      }
      client.emit('call_offer', {
        chatId: offer.chatId,
        senderId: offer.senderId,
        type: offer.type,
        sdp: offer.sdp,
        at: offer.createdAt,
      });
    }
  }
}
