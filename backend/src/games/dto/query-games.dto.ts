import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { GameStatusDto } from './update-game.dto';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO used when listing games.
 *
 * It extends the shared pagination DTO so every list endpoint
 * can use the same pagination pattern.
 */
export class QueryGamesDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    example: 'wuthering',
    description: 'Search by game name or slug.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({
    enum: GameStatusDto,
    example: GameStatusDto.ACTIVE,
  })
  @IsOptional()
  @IsEnum(GameStatusDto)
  status?: GameStatusDto;
}
