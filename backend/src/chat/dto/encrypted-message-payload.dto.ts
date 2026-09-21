import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  Validate,
  ValidateNested,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { ChatMessageContentType } from '../../generated/prisma/client';
import { ChatMediaReferenceDto } from './chat-media-reference.dto';

// Matches ciphertext's own MaxLength(20000) below - encryptionMeta is an
// arbitrary object with no per-field cap of its own, otherwise bounded
// only by whatever the request body parser's overall size limit happens
// to be (currently Express's 100kb default, re-added by
// @thallesp/nestjs-better-auth after Nest's own parser is disabled in
// main.ts) rather than anything specific to this field.
const ENCRYPTION_META_MAX_JSON_LENGTH = 20000;

@ValidatorConstraint({ name: 'BoundedJsonSize', async: false })
class BoundedJsonSizeConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (value === undefined) {
      return true;
    }
    try {
      return JSON.stringify(value).length <= ENCRYPTION_META_MAX_JSON_LENGTH;
    } catch {
      // Circular or otherwise unserializable - @IsObject() lets it through,
      // but it could never be stored as the JSON column it's headed for.
      return false;
    }
  }

  defaultMessage(): string {
    return `encryptionMeta must serialize to at most ${ENCRYPTION_META_MAX_JSON_LENGTH} characters of JSON`;
  }
}

/**
 * Opaque encrypted message payload.
 *
 * Backend never receive plaintext message content.
 * Clients encrypt before sending and decrypt after reading from the API.
 */
export class EncryptedMessagePayloadDto {
  @ApiProperty({
    example: 'base64-or-armored-ciphertext',
    description: 'Client-side encrypted message body. Never plaintext.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(20000)
  ciphertext!: string;

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
  @Validate(BoundedJsonSizeConstraint)
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
  @MaxLength(120)
  replyToId?: string;

  @ApiPropertyOptional({
    type: [ChatMediaReferenceDto],
    maxItems: 4,
    description:
      'Already-uploaded media to attach. Up to four images, or one video.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(4)
  @ValidateNested({ each: true })
  @Type(() => ChatMediaReferenceDto)
  media?: ChatMediaReferenceDto[];
}
