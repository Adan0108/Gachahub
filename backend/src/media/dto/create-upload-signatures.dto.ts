import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsOptional,
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

export enum OpaqueBlobKindDto {
  BLOB = 'BLOB',
  THUMB = 'THUMB',
}

export class UploadSignatureItemDto {
  @ApiPropertyOptional({
    enum: MediaResourceTypeDto,
    example: MediaResourceTypeDto.IMAGE,
    description: 'Required unless opaqueKind is set.',
  })
  @IsOptional()
  @IsEnum(MediaResourceTypeDto)
  resourceType?: MediaResourceTypeDto;

  @ApiPropertyOptional({
    enum: OpaqueBlobKindDto,
    description:
      'Encrypted chat blob (CHAT purpose only): stored as raw bytes, never inspected.',
  })
  @IsOptional()
  @IsEnum(OpaqueBlobKindDto)
  opaqueKind?: OpaqueBlobKindDto;
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
