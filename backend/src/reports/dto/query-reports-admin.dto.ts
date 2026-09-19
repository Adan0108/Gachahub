import { IsOptional, IsString } from 'class-validator';
import { QueryReportsDto } from './query-reports.dto';

/**
 * Adds an optional cross-game filter on top of QueryReportsDto - the
 * game-scoped moderator route never needs this (its game already comes from
 * the route), only the admin route that lists across every game at once.
 */
export class QueryReportsAdminDto extends QueryReportsDto {
  @IsOptional()
  @IsString()
  gameSlug?: string;
}
