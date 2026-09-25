import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBase64,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { MAX_BATCH_ITEMS, MAX_BLOB_BYTES } from '../chat-backup.constants';

export class BackupBlobItemDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  conversationId!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  messageId!: string;

  @ApiProperty({ description: 'Base64, at most 64 KB decoded' })
  @IsString()
  @IsBase64()
  @MaxLength(Math.ceil((MAX_BLOB_BYTES * 4) / 3) + 4)
  ciphertext!: string;
}

export class UploadBlobsDto {
  @ApiProperty({ type: [BackupBlobItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_BATCH_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => BackupBlobItemDto)
  items!: BackupBlobItemDto[];
}
