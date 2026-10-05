import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

// Takes an already-confirmed MediaUpload id (purpose AVATAR), never a raw URL.
export class UpdateAvatarDto {
  @ApiProperty({ example: 'cm123avatarupload456' })
  @IsString()
  @IsNotEmpty()
  avatarMediaUploadId!: string;
}
