import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { GameStatusDto } from './update-game.dto';

/**
 * DTO used when listing games.
 *
 * It extends the shared pagination DTO so every list endpoint
 * can use the same pagination pattern.
 */
export class QueryGamesDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsEnum(GameStatusDto)
  status?: GameStatusDto;
}
