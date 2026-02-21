import { IsString, Length, Matches } from 'class-validator';

export class ManageChatMemberDto {
  @IsString()
  @Length(3, 40)
  @Matches(/^[a-z0-9_]+$/i)
  username!: string;
}
