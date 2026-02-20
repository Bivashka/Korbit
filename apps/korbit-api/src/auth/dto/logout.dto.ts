import { IsString, Length } from 'class-validator';

export class LogoutDto {
  @IsString()
  @Length(20, 4096)
  refreshToken!: string;
}

