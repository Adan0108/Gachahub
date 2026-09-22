import { ApiProperty } from '@nestjs/swagger';
import {
  IsBase64,
  IsInt,
  IsNotEmpty,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class ExternalJoinDto {
  @ApiProperty({ description: 'The joining device, one of the caller devices' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  deviceId!: string;

  @ApiProperty({
    description: 'The epoch of the GroupInfo the join was built from',
  })
  @IsInt()
  @Min(0)
  epoch!: number;

  @ApiProperty({
    description: 'Base64 MLS public message: the external commit',
  })
  @IsNotEmpty()
  @IsBase64()
  @MaxLength(20000)
  payload!: string;

  @ApiProperty({
    description: 'Base64 GroupInfo for the epoch this join creates',
  })
  @IsNotEmpty()
  @IsBase64()
  @MaxLength(60000)
  groupInfo!: string;
}
