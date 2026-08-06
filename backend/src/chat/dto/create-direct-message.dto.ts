import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDefined, IsString, ValidateNested } from 'class-validator';
import { EncryptedMessagePayloadDto } from './encrypted-message-payload.dto';

/**
 * Request body for starting or reusing a direct conversation.
 *
 * the first message is nested so future direct-message creation can add
 * conversation-level fields without changing the encrypted message payload
 */
export class CreateDirectMessageDto {
  @ApiProperty({
    example: 'target-user-id',
    description: 'User receiving the direct message.',
  })
  @IsString()
  recipientUserId!: string;

  @ApiProperty({
    type: EncryptedMessagePayloadDto,
    description: 'Encrypted first message payload.',
  })
  @IsDefined()
  @ValidateNested()
  @Type(() => EncryptedMessagePayloadDto)
  message!: EncryptedMessagePayloadDto;
}
