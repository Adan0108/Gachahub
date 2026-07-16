import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class QueryChatMessagesDto {
  @ApiPropertyOptional({
    example: 'cm123message456',
    description:
      'Return messages created before this message id. Omit for newest page.',
  })
  @IsOptional()
  @IsString()
  beforeMessageId?: string;

  @ApiPropertyOptional({
    example: 30,
    default: 30,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 30;
}
