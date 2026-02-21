import { IsBoolean, IsIn, IsObject, IsOptional, IsString } from 'class-validator';

export class CallOfferDto {
  @IsString()
  chatId!: string;

  @IsIn(['audio', 'video'])
  type!: 'audio' | 'video';

  @IsObject()
  sdp!: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  renegotiate?: boolean;
}
