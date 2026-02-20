import { IsString, Length, Matches } from 'class-validator';

export class CreateDirectChatDto {
  @IsString()
  @Length(3, 32)
  @Matches(/^[a-zA-Z0-9_]+$/)
  username!: string;
}

