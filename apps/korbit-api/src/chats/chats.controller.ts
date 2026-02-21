import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FastifyRequest } from 'fastify';
import { mkdir, stat, unlink } from 'fs/promises';
import { createWriteStream } from 'fs';
import { extname, join } from 'path';
import { randomUUID } from 'crypto';
import { pipeline } from 'stream/promises';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../common/interfaces/jwt-payload.interface';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { ChatsService } from './chats.service';
import { CreateDirectChatDto } from './dto/create-direct-chat.dto';
import { CreateSharedChatDto } from './dto/create-shared-chat.dto';
import { ForwardMessageDto } from './dto/forward-message.dto';
import { ListMessagesQueryDto } from './dto/list-messages-query.dto';
import { MarkReadDto } from './dto/mark-read.dto';
import { SearchMessagesQueryDto } from './dto/search-messages-query.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { ToggleReactionDto } from './dto/toggle-reaction.dto';
import { UpdateMessageDto } from './dto/update-message.dto';

@Controller('chats')
export class ChatsController {
  constructor(
    private readonly chatsService: ChatsService,
    private readonly realtimeGateway: RealtimeGateway,
    private readonly configService: ConfigService,
  ) {}

  @Get()
  listChats(@CurrentUser() user: JwtPayload) {
    return this.chatsService.listChats(user.sub);
  }

  @Post('direct')
  createDirectChat(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateDirectChatDto,
  ) {
    return this.chatsService.createDirectChat(user.sub, dto);
  }

  @Post()
  createSharedChat(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateSharedChatDto,
  ) {
    return this.chatsService.createSharedChat(user.sub, dto);
  }

  @Get(':chatId/messages')
  listMessages(
    @CurrentUser() user: JwtPayload,
    @Param('chatId') chatId: string,
    @Query() query: ListMessagesQueryDto,
  ) {
    return this.chatsService.listMessages(user.sub, chatId, query);
  }

  @Get(':chatId/messages/search')
  searchMessages(
    @CurrentUser() user: JwtPayload,
    @Param('chatId') chatId: string,
    @Query() query: SearchMessagesQueryDto,
  ) {
    return this.chatsService.searchMessages(user.sub, chatId, query);
  }

  @Post(':chatId/messages')
  async sendMessage(
    @CurrentUser() user: JwtPayload,
    @Param('chatId') chatId: string,
    @Body() dto: SendMessageDto,
  ) {
    const message = await this.chatsService.sendMessage(user.sub, chatId, dto);
    this.realtimeGateway.emitNewMessage(chatId, message);
    return message;
  }

  @Post(':chatId/messages/:messageId/forward')
  async forwardMessage(
    @CurrentUser() user: JwtPayload,
    @Param('chatId') chatId: string,
    @Param('messageId') messageId: string,
    @Body() dto: ForwardMessageDto,
  ) {
    const message = await this.chatsService.forwardMessage(
      user.sub,
      chatId,
      messageId,
      dto.targetChatId,
    );
    this.realtimeGateway.emitNewMessage(dto.targetChatId, message);
    return message;
  }

  @Patch(':chatId/messages/:messageId')
  async updateMessage(
    @CurrentUser() user: JwtPayload,
    @Param('chatId') chatId: string,
    @Param('messageId') messageId: string,
    @Body() dto: UpdateMessageDto,
  ) {
    const updated = await this.chatsService.updateMessage(
      user.sub,
      user.role,
      chatId,
      messageId,
      dto,
    );
    this.realtimeGateway.emitMessageUpdated(chatId, updated);
    return updated;
  }

  @Delete(':chatId/messages/:messageId')
  async deleteMessage(
    @CurrentUser() user: JwtPayload,
    @Param('chatId') chatId: string,
    @Param('messageId') messageId: string,
  ) {
    const deleted = await this.chatsService.deleteMessage(
      user.sub,
      user.role,
      chatId,
      messageId,
    );
    this.realtimeGateway.emitMessageUpdated(chatId, deleted);
    this.realtimeGateway.emitChatPinnedMessage(chatId, null);
    return deleted;
  }

  @Post(':chatId/messages/:messageId/reactions/toggle')
  async toggleReaction(
    @CurrentUser() user: JwtPayload,
    @Param('chatId') chatId: string,
    @Param('messageId') messageId: string,
    @Body() dto: ToggleReactionDto,
  ) {
    const updated = await this.chatsService.toggleReaction(
      user.sub,
      chatId,
      messageId,
      dto.emoji,
    );
    this.realtimeGateway.emitMessageUpdated(chatId, updated);
    return updated;
  }

  @Post(':chatId/pin/:messageId')
  async pinMessage(
    @CurrentUser() user: JwtPayload,
    @Param('chatId') chatId: string,
    @Param('messageId') messageId: string,
  ) {
    const result = await this.chatsService.pinMessage(user.sub, chatId, messageId);
    this.realtimeGateway.emitChatPinnedMessage(chatId, result.pinnedMessage);
    return result;
  }

  @Delete(':chatId/pin')
  async unpinMessage(
    @CurrentUser() user: JwtPayload,
    @Param('chatId') chatId: string,
  ) {
    const result = await this.chatsService.unpinMessage(user.sub, chatId);
    this.realtimeGateway.emitChatPinnedMessage(chatId, null);
    return result;
  }

  @Post(':chatId/read')
  async markRead(
    @CurrentUser() user: JwtPayload,
    @Param('chatId') chatId: string,
    @Body() dto: MarkReadDto,
  ) {
    const receipt = await this.chatsService.markRead(user.sub, chatId, dto);
    this.realtimeGateway.emitReadReceipt(chatId, receipt);
    return receipt;
  }

  @Post(':chatId/attachments')
  async uploadAttachment(
    @CurrentUser() user: JwtPayload,
    @Param('chatId') chatId: string,
    @Req() request: FastifyRequest,
  ) {
    const part = await request.file();
    if (!part) {
      throw new BadRequestException('Файл не передан');
    }

    const maxSize = Number(
      this.configService.get<string>('MAX_UPLOAD_SIZE', `${10 * 1024 * 1024}`),
    );
    const uploadDir = this.configService.get<string>('UPLOAD_DIR', 'uploads');
    const uploadRoot = join(process.cwd(), uploadDir);
    const uploadPublicPrefix = this.configService.get<string>(
      'UPLOAD_PUBLIC_PREFIX',
      '/uploads',
    );
    await mkdir(uploadRoot, { recursive: true });

    const sourceName = part.filename || 'file';
    const extension = extname(sourceName).toLowerCase();
    const storageFileName = `${Date.now()}_${randomUUID()}${extension}`;
    const destination = join(uploadRoot, storageFileName);

    await pipeline(part.file, createWriteStream(destination));

    const uploaded = await stat(destination);
    if (uploaded.size > maxSize) {
      await unlink(destination).catch(() => undefined);
      throw new BadRequestException('Файл превышает максимально допустимый размер');
    }

    const created = await this.chatsService.sendAttachmentMessage(user.sub, chatId, {
      fileName: sourceName,
      mimeType: part.mimetype || 'application/octet-stream',
      size: uploaded.size,
      url: `${uploadPublicPrefix.replace(/\/$/, '')}/${storageFileName}`,
    });
    this.realtimeGateway.emitNewMessage(chatId, created);
    return created;
  }
}
