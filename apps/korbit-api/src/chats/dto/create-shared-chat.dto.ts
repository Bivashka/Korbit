import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';

export class CreateSharedChatDto {
  @IsIn(['GROUP', 'CHANNEL'])
  type!: 'GROUP' | 'CHANNEL';

  @IsString()
  @Length(2, 80)
  title!: string;

  @IsOptional()
  @IsString()
  @Length(0, 300)
  description?: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  avatarUrl?: string;

  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;

  @IsOptional()
  @IsString()
  @Length(3, 32)
  @Matches(/^[a-zA-Z0-9_]+$/)
  username?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @Length(3, 32, { each: true })
  @Matches(/^[a-zA-Z0-9_]+$/, { each: true })
  members?: string[];
}
