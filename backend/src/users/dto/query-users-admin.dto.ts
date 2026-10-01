import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { UserRole, UserStatus } from '../../generated/prisma/client';

export class QueryUsersAdminDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  /** Matched against name and email, case-insensitive. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
