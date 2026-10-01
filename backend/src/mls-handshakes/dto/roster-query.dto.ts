import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { BoundedEpoch } from './bounded-epoch.decorator';

export class RosterQueryDto {
  @ApiProperty({ description: 'Epoch to list the group devices at' })
  @Type(() => Number)
  @BoundedEpoch()
  epoch!: number;
}
