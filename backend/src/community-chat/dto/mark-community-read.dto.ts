import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class MarkCommunityReadDto {
  @ApiPropertyOptional({
    description:
      'Newest message the reader has seen; omit to mark the whole channel read.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  messageId?: string;
}
