import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { PROFILE_BANNER_IDS } from '../profile-banner-catalog';

export class UpdateBannerDto {
  @ApiProperty({ enum: PROFILE_BANNER_IDS, example: PROFILE_BANNER_IDS[0] })
  @IsIn(PROFILE_BANNER_IDS)
  bannerPresetId!: string;
}
