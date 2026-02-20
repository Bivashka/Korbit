import { IsString, Length, Matches } from 'class-validator';

export class LoginDto {
  @IsString()
  @Length(3, 32)
  @Matches(/^[a-zA-Z0-9_]+$/)
  username!: string;

  @IsString()
  @Length(10, 128)
  password!: string;
}

