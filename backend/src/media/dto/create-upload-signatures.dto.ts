import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  ValidateNested,
} from 'class-validator';

export enum MediaPurposeDto {
  POST = 'POST',
  COMMENT = 'COMMENT',
  CHAT = 'CHAT',
  AVATAR = 'AVATAR',
  BANNER = 'BANNER',
}

export enum MediaResourceTypeDto {
  IMAGE = 'IMAGE',
  VIDEO = 'VIDEO',
}

export class UploadSignatureItemDto {
  @ApiProperty({
    enum: MediaResourceTypeDto,
    example: MediaResourceTypeDto.IMAGE,
  })
  @IsEnum(MediaResourceTypeDto)
  resourceType!: MediaResourceTypeDto;
}

export class CreateUploadSignaturesDto {
  @ApiProperty({
    enum: MediaPurposeDto,
    example: MediaPurposeDto.POST,
  })
  @IsEnum(MediaPurposeDto)
  purpose!: MediaPurposeDto;

  @ApiProperty({
    type: [UploadSignatureItemDto],
    maxItems: 10,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => UploadSignatureItemDto)
  items!: UploadSignatureItemDto[];
}
