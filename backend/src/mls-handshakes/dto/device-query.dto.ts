import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class DeviceQueryDto {
  @ApiProperty({ description: 'One of the caller devices' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  deviceId!: string;
}
