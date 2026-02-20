import { IsIn, IsObject, IsString } from 'class-validator';

export class CallOfferDto {
  @IsString()
  chatId!: string;

  @IsIn(['audio', 'video'])
  type!: 'audio' | 'video';

  @IsObject()
  sdp!: Record<string, unknown>;
}
