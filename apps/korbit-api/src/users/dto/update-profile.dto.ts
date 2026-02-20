import { IsOptional, IsString, Length, Matches } from 'class-validator';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @Length(1, 60)
  displayName?: string;

  @IsOptional()
  @IsString()
  @Length(0, 240)
  bio?: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  @Matches(/^https?:\/\/.+$/)
  avatarUrl?: string;
}

