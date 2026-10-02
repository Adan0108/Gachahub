import { IsOptional, IsString } from 'class-validator';
import { QueryAuditLogsDto } from './query-audit-logs.dto';

/** Adds the cross-game filter only the admin route needs. */
export class QueryAuditLogsAdminDto extends QueryAuditLogsDto {
  @IsOptional()
  @IsString()
  gameSlug?: string;
}
