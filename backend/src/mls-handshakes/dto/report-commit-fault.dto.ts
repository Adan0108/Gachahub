import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { BoundedEpoch } from './bounded-epoch.decorator';

export class ReportCommitFaultDto {
  @ApiProperty({ description: 'Device id reporting the refused Commit' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  deviceId!: string;

  @ApiProperty({ description: 'Epoch the refused Commit was built from' })
  @BoundedEpoch()
  epoch!: number;

  @ApiProperty({ description: 'Why the client refused it' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}
