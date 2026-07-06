import { IsBoolean, IsOptional } from 'class-validator';

/**
 * DTO used when listing categories for a game.
 *
 * By default, most client pages only need active categories,
 * but admin pages may need inactive categories too.
 */
export class QueryGameCategoriesDto {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
