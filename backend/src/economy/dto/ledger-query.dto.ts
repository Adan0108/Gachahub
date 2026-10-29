import { IsOptional, IsString, MaxLength } from 'class-validator';

export class LedgerQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  cursor?: string;
}
