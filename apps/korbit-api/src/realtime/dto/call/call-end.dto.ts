import { IsString } from 'class-validator';

export class CallEndDto {
  @IsString()
  chatId!: string;
}

