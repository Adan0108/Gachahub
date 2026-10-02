import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

// Takes already-confirmed MediaUpload ids, not raw URLs; both optional, but the service rejects a request that supplies neither.
export class UpdateGameBrandingDto {
  @ApiPropertyOptional({ example: 'cm123iconupload456' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  iconMediaUploadId?: string;

  @ApiPropertyOptional({ example: 'cm123bannerupload456' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  bannerMediaUploadId?: string;
}
