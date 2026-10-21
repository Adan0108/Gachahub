import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

// Takes an already-confirmed MediaUpload id (purpose GROUP_PHOTO), never a raw URL.
export class UpdateGroupPhotoDto {
  @ApiProperty({ example: 'cm123groupphotoupload456' })
  @IsString()
  @IsNotEmpty()
  photoMediaUploadId: string;
}
