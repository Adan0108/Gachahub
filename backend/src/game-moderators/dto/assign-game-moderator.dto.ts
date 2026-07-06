import { IsEmail, IsOptional, IsString } from 'class-validator';

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
  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsEmail()
  email?: string;
}
