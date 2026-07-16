import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ChatMessageContentType } from '../../generated/prisma/client';

/**
 * Opaque encrypted message payload.
 *
 * The backend never receives plaintext message content. Clients encrypt before
 * sending and decrypt after reading from the API.
 */
export class EncryptedMessagePayloadDto {
  @ApiProperty({
    example: 'base64-or-armored-ciphertext',
    description: 'Client-side encrypted message body. Never plaintext.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(20000)
  ciphertext: string;

  @ApiPropertyOptional({
    example: {
      version: 'e2ee-v1',
      nonce: 'base64-nonce',
      senderKeyId: 'sender-device-key-id',
      recipientKeyIds: ['recipient-device-key-id'],
    },
    description:
      'Client-managed encryption metadata required to decrypt the ciphertext.',
  })
  @IsOptional()
  @IsObject()
  encryptionMeta?: Record<string, unknown>;

  @ApiPropertyOptional({
    enum: ChatMessageContentType,
    default: ChatMessageContentType.TEXT,
  })
  @IsOptional()
  @IsEnum(ChatMessageContentType)
  contentType?: ChatMessageContentType;

  @ApiPropertyOptional({
    example: 'client-generated-idempotency-id',
    description:
      'Optional client-generated id used to prevent duplicate sends on retry.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  clientMessageId?: string;

  @ApiPropertyOptional({
    example: 'cm123reply456',
    description: 'Optional encrypted-message reply target.',
  })
  @IsOptional()
  @IsString()
  replyToId?: string;
}
