import { IsString, Length } from 'class-validator';

export class RefreshDto {
  @IsString()
  @Length(20, 4096)
  refreshToken!: string;
}

