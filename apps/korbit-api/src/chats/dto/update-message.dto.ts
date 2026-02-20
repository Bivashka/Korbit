import { IsString, Length } from 'class-validator';

export class UpdateMessageDto {
  @IsString()
  @Length(1, 4000)
  content!: string;
}
