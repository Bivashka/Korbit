import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDirectChatDto } from './dto/create-direct-chat.dto';
import { CreateSharedChatDto } from './dto/create-shared-chat.dto';
import { ListMessagesQueryDto } from './dto/list-messages-query.dto';
import { MarkReadDto } from './dto/mark-read.dto';
import { SearchMessagesQueryDto } from './dto/search-messages-query.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { UpdateMessageDto } from './dto/update-message.dto';

@Injectable()
export class ChatsService {
  constructor(private readonly prisma: PrismaService) {}

  private userSelect() {
    return {
      id: true,
      username: true,
      displayName: true,
      avatarUrl: true,
    } satisfies Prisma.UserSelect;
  }

  private messageReferenceSelect() {
    return {
      id: true,
      chatId: true,
      senderId: true,
      content: true,
      isDeleted: true,
      deletedAt: true,
      editedAt: true,
      createdAt: true,
      updatedAt: true,
      sender: {
        select: this.userSelect(),
      },
    } satisfies Prisma.MessageSelect;
  }

  private messageInclude() {
    return {
      sender: {
        select: this.userSelect(),
      },
      attachments: true,
      reactions: {
        include: {
          user: {
            select: this.userSelect(),
          },
        },
        orderBy: {
          createdAt: 'asc',
        },
      },
      replyToMessage: {
        select: this.messageReferenceSelect(),
      },
      forwardedFromMessage: {
        select: this.messageReferenceSelect(),
      },
    } satisfies Prisma.MessageInclude;
  }

  private directChatInclude() {
    return {
      members: {
        include: {
          user: {
            select: this.userSelect(),
          },
        },
      },
      messages: {
        take: 1,
        orderBy: { createdAt: 'desc' as const },
        include: this.messageInclude(),
      },
      pinnedMessage: {
        select: this.messageReferenceSelect(),
      },
    } satisfies Prisma.ChatInclude;
  }

  async listChats(userId: string) {
    const memberships = await this.prisma.chatMember.findMany({
      where: { userId },
      include: {
        lastReadMessage: {
          select: {
            id: true,
            createdAt: true,
          },
        },
        chat: {
          include: this.directChatInclude(),
        },
      },
      orderBy: {
        chat: {
          updatedAt: 'desc',
        },
      },
    });

    const unreadCounts = await Promise.all(
      memberships.map((membership) =>
        this.prisma.message.count({
          where: {
            chatId: membership.chat.id,
            senderId: {
              not: userId,
            },
            ...(membership.lastReadMessage
              ? {
                  createdAt: {
                    gt: membership.lastReadMessage.createdAt,
                  },
                }
              : {}),
          },
        }),
      ),
    );

    return memberships.map((membership, index) => {
      const isDirect = membership.chat.type === 'DIRECT';
      const peer = isDirect
        ? membership.chat.members.find((m) => m.userId !== userId)?.user
        : null;
      const peerMembership = isDirect
        ? membership.chat.members.find((m) => m.userId !== userId)
        : null;
      return {
        id: membership.chat.id,
        type: membership.chat.type,
        peer,
        title: membership.chat.title ?? null,
        description: membership.chat.description ?? null,
        avatarUrl: membership.chat.avatarUrl ?? null,
        username: membership.chat.username ?? null,
        isPublic: membership.chat.isPublic ?? false,
        ownerId: membership.chat.ownerId ?? null,
        memberCount: membership.chat.members.length,
        lastReadMessageId: membership.lastReadMessageId,
        peerLastReadMessageId: peerMembership?.lastReadMessageId ?? null,
        lastMessage: membership.chat.messages[0] ?? null,
        pinnedMessage: membership.chat.pinnedMessage ?? null,
        unreadCount: unreadCounts[index] ?? 0,
      };
    });
  }

  async createDirectChat(userId: string, dto: CreateDirectChatDto) {
    const username = dto.username.trim().toLowerCase();
    const target = await this.prisma.user.findUnique({
      where: { username },
      select: { id: true },
    });
    if (!target) {
      throw new NotFoundException('Пользователь не найден');
    }
    if (target.id === userId) {
      throw new BadRequestException('Нельзя создать чат с самим собой');
    }

    const [userAId, userBId] = [userId, target.id].sort();

    const existing = await this.prisma.directChat.findUnique({
      where: { userAId_userBId: { userAId, userBId } },
      include: {
        chat: {
          include: this.directChatInclude(),
        },
      },
    });

    if (existing) {
      return this.mapChatResponse(existing.chat, userId);
    }

    try {
      const chat = await this.prisma.$transaction(async (tx) => {
        const createdChat = await tx.chat.create({
          data: {
            type: 'DIRECT',
          },
        });

        await tx.directChat.create({
          data: {
            chatId: createdChat.id,
            userAId,
            userBId,
          },
        });

        await tx.chatMember.createMany({
          data: [
            { chatId: createdChat.id, userId: userAId },
            { chatId: createdChat.id, userId: userBId },
          ],
        });

        return tx.chat.findUniqueOrThrow({
          where: { id: createdChat.id },
          include: this.directChatInclude(),
        });
      });

      return this.mapChatResponse(chat, userId);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const fallback = await this.prisma.directChat.findUnique({
          where: { userAId_userBId: { userAId, userBId } },
          include: {
            chat: {
              include: this.directChatInclude(),
            },
          },
        });
        if (fallback) {
          return this.mapChatResponse(fallback.chat, userId);
        }
      }
      throw error;
    }
  }

  async createSharedChat(userId: string, dto: CreateSharedChatDto) {
    const title = dto.title.trim();
    if (!title) {
      throw new BadRequestException('Название чата не указано');
    }

    const description = dto.description?.trim() || null;
    const avatarUrl = dto.avatarUrl?.trim() || null;
    const isPublic = dto.type === 'CHANNEL' ? Boolean(dto.isPublic) : false;
    const username = dto.username?.trim().toLowerCase() || null;

    if (isPublic && !username) {
      throw new BadRequestException('Для публичного канала нужен username');
    }

    if (dto.type === 'GROUP' && dto.isPublic) {
      throw new BadRequestException('Группы могут быть только приватными');
    }

    const requestedUsernames = Array.from(
      new Set((dto.members ?? []).map((value) => value.trim().toLowerCase()).filter(Boolean)),
    );

    const users = requestedUsernames.length
      ? await this.prisma.user.findMany({
          where: {
            username: {
              in: requestedUsernames,
            },
          },
          select: {
            id: true,
            username: true,
          },
        })
      : [];

    const found = new Set(users.map((item) => item.username));
    const missing = requestedUsernames.filter((usernameValue) => !found.has(usernameValue));
    if (missing.length > 0) {
      throw new NotFoundException(`Пользователи не найдены: ${missing.join(', ')}`);
    }

    const memberIds = new Set<string>([userId, ...users.map((item) => item.id)]);

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const chat = await tx.chat.create({
          data: {
            type: dto.type,
            title,
            description,
            avatarUrl,
            isPublic,
            username: isPublic ? username : null,
            ownerId: userId,
          },
        });

        await tx.chatMember.createMany({
          data: Array.from(memberIds).map((memberId) => ({
            chatId: chat.id,
            userId: memberId,
          })),
        });

        return tx.chat.findUniqueOrThrow({
          where: { id: chat.id },
          include: this.directChatInclude(),
        });
      });

      return this.mapChatResponse(created, userId);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new BadRequestException('Такой username канала уже занят');
      }
      throw error;
    }
  }

  async listMessages(
    userId: string,
    chatId: string,
    query: ListMessagesQueryDto,
  ) {
    await this.assertMember(chatId, userId);

    const limit = query.limit ?? 30;
    const messages = await this.prisma.message.findMany({
      where: { chatId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      ...(query.cursor
        ? {
            cursor: { id: query.cursor },
            skip: 1,
          }
        : {}),
      include: this.messageInclude(),
    });

    return {
      items: [...messages].reverse(),
      nextCursor: messages.length === limit ? messages[messages.length - 1].id : null,
    };
  }

  async searchMessages(
    userId: string,
    chatId: string,
    query: SearchMessagesQueryDto,
  ) {
    await this.assertMember(chatId, userId);

    const text = query.q.trim();
    if (!text) {
      throw new BadRequestException('Пустой поисковый запрос');
    }

    return this.prisma.message.findMany({
      where: {
        chatId,
        isDeleted: false,
        OR: [
          {
            content: {
              contains: text,
              mode: 'insensitive',
            },
          },
          {
            attachments: {
              some: {
                fileName: {
                  contains: text,
                  mode: 'insensitive',
                },
              },
            },
          },
        ],
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: query.limit ?? 20,
      include: this.messageInclude(),
    });
  }

  async sendMessage(userId: string, chatId: string, dto: SendMessageDto) {
    await this.assertMember(chatId, userId);

    const content = dto.content.trim();
    if (!content) {
      throw new BadRequestException('Сообщение не может быть пустым');
    }

    const replyToMessageId = dto.replyToMessageId?.trim() || undefined;
    if (replyToMessageId) {
      const replyMessage = await this.prisma.message.findUnique({
        where: { id: replyToMessageId },
        select: { chatId: true, isDeleted: true },
      });
      if (!replyMessage || replyMessage.chatId !== chatId) {
        throw new BadRequestException('Сообщение для ответа не найдено');
      }
      if (replyMessage.isDeleted) {
        throw new BadRequestException('Нельзя отвечать на удалённое сообщение');
      }
    }

    const forwardedFromMessageId = dto.forwardedFromMessageId?.trim() || undefined;
    if (forwardedFromMessageId) {
      const sourceMessage = await this.prisma.message.findUnique({
        where: { id: forwardedFromMessageId },
        select: { chatId: true, isDeleted: true },
      });
      if (!sourceMessage) {
        throw new BadRequestException('Исходное сообщение для пересылки не найдено');
      }
      if (sourceMessage.isDeleted) {
        throw new BadRequestException('Нельзя переслать удалённое сообщение');
      }
      const hasAccess = await this.isMember(sourceMessage.chatId, userId);
      if (!hasAccess) {
        throw new ForbiddenException('Нет доступа к исходному сообщению');
      }
    }

    const message = await this.prisma.$transaction(async (tx) => {
      const created = await tx.message.create({
        data: {
          chatId,
          senderId: userId,
          content,
          replyToMessageId,
          forwardedFromMessageId,
        },
        include: this.messageInclude(),
      });

      await tx.chat.update({
        where: { id: chatId },
        data: { updatedAt: new Date() },
      });

      return created;
    });

    return message;
  }

  async sendAttachmentMessage(
    userId: string,
    chatId: string,
    attachment: {
      fileName: string;
      mimeType: string;
      size: number;
      url: string;
    },
  ) {
    await this.assertMember(chatId, userId);

    const content = attachment.mimeType.startsWith('image/')
      ? 'Изображение'
      : `Файл: ${attachment.fileName}`;

    const message = await this.prisma.$transaction(async (tx) => {
      const created = await tx.message.create({
        data: {
          chatId,
          senderId: userId,
          content,
          attachments: {
            create: {
              fileName: attachment.fileName,
              mimeType: attachment.mimeType,
              size: attachment.size,
              url: attachment.url,
            },
          },
        },
        include: this.messageInclude(),
      });

      await tx.chat.update({
        where: { id: chatId },
        data: { updatedAt: new Date() },
      });

      return created;
    });

    return message;
  }

  async forwardMessage(
    userId: string,
    sourceChatId: string,
    messageId: string,
    targetChatId: string,
  ) {
    await this.assertMember(sourceChatId, userId);
    await this.assertMember(targetChatId, userId);

    const source = await this.prisma.message.findFirst({
      where: {
        id: messageId,
        chatId: sourceChatId,
      },
      include: {
        attachments: true,
      },
    });
    if (!source) {
      throw new NotFoundException('Исходное сообщение не найдено');
    }
    if (source.isDeleted) {
      throw new BadRequestException('Нельзя переслать удалённое сообщение');
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const forwarded = await tx.message.create({
        data: {
          chatId: targetChatId,
          senderId: userId,
          content: source.content,
          forwardedFromMessageId: source.id,
          attachments: source.attachments.length
            ? {
                create: source.attachments.map((attachment) => ({
                  fileName: attachment.fileName,
                  mimeType: attachment.mimeType,
                  size: attachment.size,
                  url: attachment.url,
                })),
              }
            : undefined,
        },
        include: this.messageInclude(),
      });

      await tx.chat.update({
        where: { id: targetChatId },
        data: { updatedAt: new Date() },
      });

      return forwarded;
    });

    return created;
  }

  async toggleReaction(
    userId: string,
    chatId: string,
    messageId: string,
    emoji: string,
  ) {
    await this.assertMember(chatId, userId);

    const normalizedEmoji = emoji.trim();
    if (!normalizedEmoji) {
      throw new BadRequestException('Эмодзи реакции не указан');
    }

    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: { id: true, chatId: true, isDeleted: true },
    });
    if (!message || message.chatId !== chatId) {
      throw new NotFoundException('Сообщение не найдено');
    }
    if (message.isDeleted) {
      throw new BadRequestException('Нельзя поставить реакцию на удалённое сообщение');
    }

    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.messageReaction.findUnique({
        where: {
          messageId_userId_emoji: {
            messageId,
            userId,
            emoji: normalizedEmoji,
          },
        },
        select: { id: true },
      });

      if (existing) {
        await tx.messageReaction.delete({
          where: { id: existing.id },
        });
      } else {
        await tx.messageReaction.create({
          data: {
            messageId,
            userId,
            emoji: normalizedEmoji,
          },
        });
      }
    });

    const updatedMessage = await this.prisma.message.findUniqueOrThrow({
      where: { id: messageId },
      include: this.messageInclude(),
    });

    return updatedMessage;
  }

  async pinMessage(userId: string, chatId: string, messageId: string) {
    await this.assertMember(chatId, userId);

    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: {
        id: true,
        chatId: true,
        isDeleted: true,
      },
    });
    if (!message || message.chatId !== chatId) {
      throw new NotFoundException('Сообщение не найдено');
    }
    if (message.isDeleted) {
      throw new BadRequestException('Нельзя закрепить удалённое сообщение');
    }

    const chat = await this.prisma.chat.update({
      where: { id: chatId },
      data: {
        pinnedMessageId: messageId,
        updatedAt: new Date(),
      },
      include: {
        pinnedMessage: {
          select: this.messageReferenceSelect(),
        },
      },
    });

    return {
      chatId: chat.id,
      pinnedMessage: chat.pinnedMessage ?? null,
    };
  }

  async unpinMessage(userId: string, chatId: string) {
    await this.assertMember(chatId, userId);

    const chat = await this.prisma.chat.update({
      where: { id: chatId },
      data: {
        pinnedMessageId: null,
        updatedAt: new Date(),
      },
    });

    return {
      chatId: chat.id,
      pinnedMessage: null,
    };
  }

  async updateMessage(
    userId: string,
    role: UserRole,
    chatId: string,
    messageId: string,
    dto: UpdateMessageDto,
  ) {
    await this.assertMember(chatId, userId);

    const existing = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: {
        id: true,
        chatId: true,
        senderId: true,
        isDeleted: true,
      },
    });
    if (!existing || existing.chatId !== chatId) {
      throw new NotFoundException('Сообщение не найдено');
    }
    if (existing.isDeleted) {
      throw new BadRequestException('Удалённое сообщение нельзя редактировать');
    }
    if (existing.senderId !== userId && role !== 'ADMIN') {
      throw new ForbiddenException('Можно редактировать только свои сообщения');
    }

    const content = dto.content.trim();
    if (!content) {
      throw new BadRequestException('Сообщение не может быть пустым');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const message = await tx.message.update({
        where: { id: messageId },
        data: {
          content,
          editedAt: new Date(),
        },
        include: this.messageInclude(),
      });

      await tx.chat.update({
        where: { id: chatId },
        data: { updatedAt: new Date() },
      });

      return message;
    });

    return updated;
  }

  async deleteMessage(
    userId: string,
    role: UserRole,
    chatId: string,
    messageId: string,
  ) {
    await this.assertMember(chatId, userId);

    const existing = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: {
        id: true,
        chatId: true,
        senderId: true,
        isDeleted: true,
      },
    });
    if (!existing || existing.chatId !== chatId) {
      throw new NotFoundException('Сообщение не найдено');
    }
    if (existing.senderId !== userId && role !== 'ADMIN') {
      throw new ForbiddenException('Можно удалять только свои сообщения');
    }

    if (existing.isDeleted) {
      return this.prisma.message.findUniqueOrThrow({
        where: { id: messageId },
        include: this.messageInclude(),
      });
    }

    const deletedMessage = await this.prisma.$transaction(async (tx) => {
      await tx.attachment.deleteMany({
        where: { messageId },
      });
      await tx.messageReaction.deleteMany({
        where: { messageId },
      });

      const message = await tx.message.update({
        where: { id: messageId },
        data: {
          isDeleted: true,
          deletedAt: new Date(),
          editedAt: null,
          content: 'Сообщение удалено',
          replyToMessageId: null,
        },
        include: this.messageInclude(),
      });

      await tx.chat.update({
        where: { id: chatId },
        data: {
          updatedAt: new Date(),
        },
      });
      await tx.chat.updateMany({
        where: {
          id: chatId,
          pinnedMessageId: messageId,
        },
        data: {
          pinnedMessageId: null,
        },
      });

      return message;
    });

    return deletedMessage;
  }

  async markRead(userId: string, chatId: string, dto: MarkReadDto) {
    await this.assertMember(chatId, userId);

    let messageId = dto.messageId;
    if (!messageId) {
      const latest = await this.prisma.message.findFirst({
        where: { chatId },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      messageId = latest?.id;
    } else {
      const message = await this.prisma.message.findUnique({
        where: { id: messageId },
        select: { id: true, chatId: true },
      });
      if (!message || message.chatId !== chatId) {
        throw new NotFoundException('Сообщение не найдено в этом чате');
      }
    }

    await this.prisma.chatMember.update({
      where: {
        chatId_userId: {
          chatId,
          userId,
        },
      },
      data: {
        lastReadMessageId: messageId ?? null,
      },
    });

    return {
      chatId,
      userId,
      messageId: messageId ?? null,
    };
  }

  async isMember(chatId: string, userId: string) {
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

  async getUserChatIds(userId: string) {
    const memberships = await this.prisma.chatMember.findMany({
      where: { userId },
      select: { chatId: true },
    });
    return memberships.map((item) => item.chatId);
  }

  private async assertMember(chatId: string, userId: string) {
    const allowed = await this.isMember(chatId, userId);
    if (!allowed) {
      throw new ForbiddenException('Вы не являетесь участником этого чата');
    }
  }

  private mapChatResponse(
    chat: {
      id: string;
      type: string;
      title: string | null;
      description: string | null;
      avatarUrl: string | null;
      username: string | null;
      isPublic: boolean;
      ownerId: string | null;
      members: Array<{
        userId: string;
        lastReadMessageId: string | null;
        user: {
          id: string;
          username: string;
          displayName: string | null;
          avatarUrl: string | null;
        };
      }>;
      messages: Array<Record<string, unknown>>;
      pinnedMessage: Record<string, unknown> | null;
    },
    userId: string,
  ) {
    const ownMembership = chat.members.find((member) => member.userId === userId);
    const peerMember = chat.type === 'DIRECT'
      ? chat.members.find((member) => member.userId !== userId)
      : null;
    return {
      id: chat.id,
      type: chat.type,
      peer: peerMember?.user ?? null,
      title: chat.title ?? null,
      description: chat.description ?? null,
      avatarUrl: chat.avatarUrl ?? null,
      username: chat.username ?? null,
      isPublic: chat.isPublic ?? false,
      ownerId: chat.ownerId ?? null,
      memberCount: chat.members.length,
      lastReadMessageId: ownMembership?.lastReadMessageId ?? null,
      peerLastReadMessageId: peerMember?.lastReadMessageId ?? null,
      lastMessage: chat.messages[0] ?? null,
      pinnedMessage: chat.pinnedMessage ?? null,
      unreadCount: 0,
    };
  }
}
