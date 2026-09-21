import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsString, MaxLength, Min } from 'class-validator';

export class ReportCommitFaultDto {
  @ApiProperty({ description: 'Device id reporting the refused Commit' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  deviceId!: string;

  @ApiProperty({ description: 'Epoch the refused Commit was built from' })
  @IsInt()
  @Min(0)
  epoch!: number;

  @ApiProperty({ description: 'Why the client refused it' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}
