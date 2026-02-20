import { Type } from 'class-transformer';
import { IsInt, IsString, Max, Min } from 'class-validator';

export class SearchMessagesQueryDto {
  @IsString()
  q!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 20;
}
