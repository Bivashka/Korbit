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

type SocketUser = JwtPayload;

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
      throw new WsException('Forbidden chat');
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
      throw new WsException('Forbidden chat');
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
        throw new WsException('Message does not belong to chat');
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

  emitNewMessage(
    chatId: string,
    message: {
      id: string;
      chatId: string;
      senderId: string;
      content: string;
      createdAt: Date;
      updatedAt: Date;
      sender: {
        id: string;
        username: string;
        displayName: string | null;
        avatarUrl: string | null;
      };
    },
  ) {
    this.server.to(this.chatRoom(chatId)).emit('new_message', {
      ...message,
      createdAt: message.createdAt.toISOString(),
      updatedAt: message.updatedAt.toISOString(),
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

  private getClientUser(client: Socket): SocketUser {
    const user = client.data.user as SocketUser | undefined;
    if (!user) {
      throw new WsException('Unauthorized');
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
      throw new WsException('Missing auth token');
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
}

