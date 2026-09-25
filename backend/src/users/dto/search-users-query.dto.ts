import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export const SEARCH_DEFAULT_LIMIT = 8;

export class SearchUsersQueryDto {
  @ApiProperty({
    description: 'Display-name text, 2-50 chars',
    minLength: 2,
    maxLength: 50,
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  q!: string;

  @ApiPropertyOptional({ default: SEARCH_DEFAULT_LIMIT, maximum: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  limit: number = SEARCH_DEFAULT_LIMIT;
}
