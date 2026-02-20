import { IsObject, IsString } from 'class-validator';

export class CallAnswerDto {
  @IsString()
  chatId!: string;

  @IsObject()
  sdp!: Record<string, unknown>;
}
