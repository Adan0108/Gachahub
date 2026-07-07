import { IsEmail, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO used by admins to assign a user as a moderator of a game.
 *
 * The admin can provide either:
 * - userId: direct database user id
 * - email: easier for testing/admin usage
 *
 * The service will validate that at least one of them exists.
 */
export class AssignGameModeratorDto {
  @ApiPropertyOptional({
    example: 'cm123abc456',
    description: 'Target user id. Use either userId or email.',
  })
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiPropertyOptional({
    example: 'moderator@example.com',
    description: 'Target user email. Easier for admin tools.',
  })
  @IsOptional()
  @IsEmail()
  email?: string;
}
