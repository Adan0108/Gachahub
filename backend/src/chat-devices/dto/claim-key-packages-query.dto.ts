import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/** Matches the most devices one Commit may add (SubmitHandshakeDto). */
const MAX_DEVICE_IDS = 50;

export class ClaimKeyPackagesQueryDto {
  @ApiPropertyOptional({
    description: 'Skip this device, e.g. the one creating the group',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  excludeDeviceId?: string;

  @ApiPropertyOptional({
    description: 'Claim for a group you are in, instead of for messaging',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  conversationId?: string;

  @ApiPropertyOptional({
    description: 'Comma-separated device ids: claim for only these',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.split(',') : value,
  )
  @IsArray()
  @ArrayMaxSize(MAX_DEVICE_IDS)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  deviceIds?: string[];
}
