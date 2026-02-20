import { IsOptional, IsString } from 'class-validator';

export class ReadReceiptDto {
  @IsString()
  chatId!: string;

  @IsOptional()
  @IsString()
  messageId?: string;
}

