import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBase64,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { BoundedEpoch } from './bounded-epoch.decorator';

/** Most devices one Commit may add or remove; the work handed to a device is chunked to it. */
export const MAX_DEVICES_PER_COMMIT = 50;

export class WelcomeDto {
  @ApiProperty({ description: 'Base64-encoded MLS Welcome wire bytes' })
  @IsNotEmpty()
  @IsBase64()
  @MaxLength(20000)
  payload!: string;

  @ApiProperty({
    type: [String],
    description: 'Device ids that receive this one Welcome',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_DEVICES_PER_COMMIT)
  @ArrayUnique()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(64, { each: true })
  recipientDeviceIds!: string[];
}

export class SubmitHandshakeDto {
  @ApiProperty({ description: 'Device id submitting this Commit' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  deviceId!: string;

  @ApiProperty({ description: 'Epoch this Commit was built from' })
  @BoundedEpoch()
  epoch!: number;

  @ApiProperty({
    description: 'Base64-encoded MLS PrivateMessage (commit) wire bytes',
  })
  @IsNotEmpty()
  @IsBase64()
  @MaxLength(20000)
  payload!: string;

  @ApiProperty({
    required: false,
    description:
      'Base64 GroupInfo for the epoch this Commit creates, so a device can later join by itself',
  })
  @IsOptional()
  @IsBase64()
  @MaxLength(60000)
  groupInfo?: string;

  @ApiProperty({
    type: WelcomeDto,
    required: false,
    description:
      'The one Welcome for every device this Commit adds; omitted when it adds none',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => WelcomeDto)
  welcome?: WelcomeDto;

  // Required, no default: omission is refused rather than read as "changes no one".
  @ApiProperty({
    type: [String],
    description: 'Device ids this Commit adds - exactly the Welcome recipients',
  })
  @IsArray()
  @ArrayMaxSize(MAX_DEVICES_PER_COMMIT)
  @ArrayUnique()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(64, { each: true })
  addedDeviceIds!: string[];

  @ApiProperty({
    type: [String],
    description: 'Device ids this Commit removes from the group',
  })
  @IsArray()
  @ArrayMaxSize(MAX_DEVICES_PER_COMMIT)
  @ArrayUnique()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(64, { each: true })
  removedDeviceIds!: string[];
}
