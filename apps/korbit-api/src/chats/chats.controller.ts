import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../common/interfaces/jwt-payload.interface';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { ChatsService } from './chats.service';
import { CreateDirectChatDto } from './dto/create-direct-chat.dto';
import { ListMessagesQueryDto } from './dto/list-messages-query.dto';
import { MarkReadDto } from './dto/mark-read.dto';
import { SendMessageDto } from './dto/send-message.dto';

@Controller('chats')
export class ChatsController {
  constructor(
    private readonly chatsService: ChatsService,
    private readonly realtimeGateway: RealtimeGateway,
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

  @Get(':chatId/messages')
  listMessages(
    @CurrentUser() user: JwtPayload,
    @Param('chatId') chatId: string,
    @Query() query: ListMessagesQueryDto,
  ) {
    return this.chatsService.listMessages(user.sub, chatId, query);
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
}

