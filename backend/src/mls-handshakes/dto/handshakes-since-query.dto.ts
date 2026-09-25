import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsOptional } from 'class-validator';
import { BoundedEpoch } from './bounded-epoch.decorator';

export class HandshakesSinceQueryDto {
  @ApiPropertyOptional({
    description:
      'Return Commits from this epoch on; a full page means call again with the client’s new epoch',
    default: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @BoundedEpoch()
  sinceEpoch: number = 0;
}
