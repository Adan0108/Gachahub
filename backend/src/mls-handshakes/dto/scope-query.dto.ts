import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

export const MLS_SCOPES = ['pending', 'full'] as const;
export type MlsScope = (typeof MLS_SCOPES)[number];

export class ScopeQueryDto {
  @ApiPropertyOptional({
    enum: MLS_SCOPES,
    description:
      '`full` also finds new, revoked and leftover devices but costs more; default `pending`',
  })
  @IsOptional()
  @IsIn(MLS_SCOPES)
  scope?: MlsScope;
}
