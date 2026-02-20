import {
  IsInt,
  IsISO8601,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

export class CreateInviteDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  maxUses?: number;

  @IsOptional()
  @IsISO8601()
  expiresAt?: string;
}

