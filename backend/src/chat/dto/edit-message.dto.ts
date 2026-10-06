import { ApiProperty, PickType } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { EncryptedMessagePayloadDto } from './encrypted-message-payload.dto';

/**
 * Request body for editing a text message.
 *
 * The new text travels as a new encrypted message (an MLS application message the other
 * devices decrypt like any other); the backend still never sees plaintext.
 */
export class EditMessageDto extends PickType(EncryptedMessagePayloadDto, [
  'ciphertext',
  'encryptionMeta',
] as const) {
  @ApiProperty({
    example: 'client-generated-idempotency-id',
    description:
      'Client-generated id so a retry of the same edit is not applied twice.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  clientMessageId!: string;
}
