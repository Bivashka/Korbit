import { IsObject, IsString } from 'class-validator';

export class CallIceCandidateDto {
  @IsString()
  chatId!: string;

  @IsObject()
  candidate!: Record<string, unknown>;
}
