import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDirectChatDto } from './dto/create-direct-chat.dto';
import { ListMessagesQueryDto } from './dto/list-messages-query.dto';
import { MarkReadDto } from './dto/mark-read.dto';
import { SendMessageDto } from './dto/send-message.dto';

@Injectable()
export class ChatsService {
  constructor(private readonly prisma: PrismaService) {}

  async listChats(userId: string) {
    const memberships = await this.prisma.chatMember.findMany({
      where: { userId },
      include: {
        chat: {
          include: {
            members: {
              include: {
                user: {
                  select: {
                    id: true,
                    username: true,
                    displayName: true,
                    avatarUrl: true,
                  },
                },
              },
            },
            messages: {
              take: 1,
              orderBy: { createdAt: 'desc' },
              include: {
                sender: {
                  select: {
                    id: true,
                    username: true,
                    displayName: true,
                  },
                },
                attachments: true,
              },
            },
          },
        },
      },
      orderBy: {
        chat: {
          updatedAt: 'desc',
        },
      },
    });

    return memberships.map((membership) => {
      const peer = membership.chat.members.find((m) => m.userId !== userId)?.user;
      return {
        id: membership.chat.id,
        type: membership.chat.type,
        peer,
        lastReadMessageId: membership.lastReadMessageId,
        lastMessage: membership.chat.messages[0] ?? null,
      };
    });
  }

  async createDirectChat(userId: string, dto: CreateDirectChatDto) {
    const username = dto.username.trim().toLowerCase();
    const target = await this.prisma.user.findUnique({
      where: { username },
      select: { id: true, username: true },
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
          include: {
            members: {
              include: {
                user: {
                  select: {
                    id: true,
                    username: true,
                    displayName: true,
                    avatarUrl: true,
                  },
                },
              },
            },
            messages: {
              take: 1,
              orderBy: { createdAt: 'desc' },
              include: {
                sender: {
                  select: {
                    id: true,
                    username: true,
                    displayName: true,
                  },
                },
                attachments: true,
              },
            },
          },
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
          include: {
            members: {
              include: {
                user: {
                  select: {
                    id: true,
                    username: true,
                    displayName: true,
                    avatarUrl: true,
                  },
                },
              },
            },
            messages: {
              take: 1,
              orderBy: { createdAt: 'desc' },
              include: {
                sender: {
                  select: {
                    id: true,
                    username: true,
                    displayName: true,
                  },
                },
                attachments: true,
              },
            },
          },
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
              include: {
                members: {
                  include: {
                    user: {
                      select: {
                        id: true,
                        username: true,
                        displayName: true,
                        avatarUrl: true,
                      },
                    },
                  },
                },
                messages: {
                  take: 1,
                  orderBy: { createdAt: 'desc' },
                  include: {
                    sender: {
                      select: {
                        id: true,
                        username: true,
                        displayName: true,
                      },
                    },
                    attachments: true,
                  },
                },
              },
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
      include: {
        sender: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatarUrl: true,
          },
        },
        attachments: true,
      },
    });

    return {
      items: [...messages].reverse(),
      nextCursor: messages.length === limit ? messages[messages.length - 1].id : null,
    };
  }

  async sendMessage(userId: string, chatId: string, dto: SendMessageDto) {
    await this.assertMember(chatId, userId);
    const content = dto.content.trim();
    if (!content) {
      throw new BadRequestException('Сообщение не может быть пустым');
    }

    const message = await this.prisma.$transaction(async (tx) => {
      const created = await tx.message.create({
        data: {
          chatId,
          senderId: userId,
          content,
        },
        include: {
          sender: {
            select: {
              id: true,
              username: true,
              displayName: true,
              avatarUrl: true,
            },
          },
          attachments: true,
        },
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
        include: {
          sender: {
            select: {
              id: true,
              username: true,
              displayName: true,
              avatarUrl: true,
            },
          },
          attachments: true,
        },
      });

      await tx.chat.update({
        where: { id: chatId },
        data: { updatedAt: new Date() },
      });

      return created;
    });

    return message;
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
      messages: Array<{
        id: string;
        content: string;
        createdAt: Date;
        attachments: Array<{
          id: string;
          messageId: string;
          fileName: string;
          mimeType: string;
          size: number;
          url: string;
          createdAt: Date;
        }>;
        sender: {
          id: string;
          username: string;
          displayName: string | null;
        };
      }>;
    },
    userId: string,
  ) {
    const ownMembership = chat.members.find((member) => member.userId === userId);
    return {
      id: chat.id,
      type: chat.type,
      peer: chat.members.find((member) => member.userId !== userId)?.user ?? null,
      lastReadMessageId: ownMembership?.lastReadMessageId ?? null,
      lastMessage: chat.messages[0] ?? null,
    };
  }
}
