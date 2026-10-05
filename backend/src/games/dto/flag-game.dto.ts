import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class FlagGameDto {
  @ApiPropertyOptional({ example: 'Banner looks outdated after a rebrand.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
