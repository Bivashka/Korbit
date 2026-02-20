import { Module } from '@nestjs/common';
import { RealtimeModule } from '../realtime/realtime.module';
import { ChatsController } from './chats.controller';
import { ChatsService } from './chats.service';

@Module({
  imports: [RealtimeModule],
  controllers: [ChatsController],
  providers: [ChatsService],
  exports: [ChatsService],
})
export class ChatsModule {}

