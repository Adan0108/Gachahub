import { IsBoolean, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO used when listing categories for a game.
 *
 * By default, most client pages only need active categories,
 * but admin pages may need inactive categories too.
 */
export class QueryGameCategoriesDto {
  @ApiPropertyOptional({
    example: true,
    description: 'Filter categories by active status.',
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
