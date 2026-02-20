import { IsBoolean, IsString } from 'class-validator';

export class TypingDto {
  @IsString()
  chatId!: string;

  @IsBoolean()
  isTyping!: boolean;
}

