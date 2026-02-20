import { IsString, Length } from 'class-validator';

export class ToggleReactionDto {
  @IsString()
  @Length(1, 32)
  emoji!: string;
}
