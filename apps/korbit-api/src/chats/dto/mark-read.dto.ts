import { IsOptional, IsString } from 'class-validator';

export class MarkReadDto {
  @IsOptional()
  @IsString()
  messageId?: string;
}

