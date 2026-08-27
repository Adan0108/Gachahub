import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, ValidateNested } from 'class-validator';
import { ConfirmMediaUploadDto } from './confirm-media-upload.dto';

export class ConfirmMediaUploadsDto {
  @ApiProperty({
    type: [ConfirmMediaUploadDto],
    minItems: 1,
    maxItems: 10,
  })
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => ConfirmMediaUploadDto)
  items!: ConfirmMediaUploadDto[];
}
