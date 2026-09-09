import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { ChatMessageContentType } from '../../generated/prisma/client';

/**
 * Request body for editing an encrypted chat message.
 *
 * The backend still never receives plaintext. Editing replaces the old
 * ciphertext with a new encrypted payload from the client.
 */
export class EditMessageDto {
  @ApiProperty({
    example: 'new-base64-or-armored-ciphertext',
    description: 'Updated client-side encrypted message body. Never plaintext.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(20000)
  ciphertext!: string;

  @ApiPropertyOptional({
    example: {
      version: 'e2ee-v1',
      nonce: 'new-base64-nonce',
      senderKeyId: 'sender-device-key-id',
      recipientKeyIds: ['recipient-device-key-id'],
    },
    description:
      'Client-managed encryption metadata for the updated ciphertext.',
  })
  @ValidateIf((object: EditMessageDto) => object.encryptionMeta !== undefined)
  @IsObject()
  encryptionMeta?: Record<string, unknown>;

  @ApiPropertyOptional({
    enum: ChatMessageContentType,
    default: ChatMessageContentType.TEXT,
  })
  @IsOptional()
  @IsEnum(ChatMessageContentType)
  contentType?: ChatMessageContentType;
}
