import { IsOptional, IsString, Length, Matches } from 'class-validator';

export class RegisterDto {
  @IsString()
  @Length(3, 32)
  @Matches(/^[a-zA-Z0-9_]+$/)
  username!: string;

  @IsString()
  @Length(10, 128)
  password!: string;

  @IsOptional()
  @IsString()
  @Length(1, 60)
  displayName?: string;

  @IsOptional()
  @IsString()
  @Length(4, 64)
  inviteCode?: string;
}

