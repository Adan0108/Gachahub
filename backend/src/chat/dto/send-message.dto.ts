import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDefined, ValidateNested } from 'class-validator';
import { EncryptedMessagePayloadDto } from './encrypted-message-payload.dto';

/**
 * Request body for sending a message to an existing convo.
 *
 * Payload is nested to keep message encryption fields grouped and reusable
 * across first-message and follow-up-message endpoints.
 */
export class SendMessageDto {
  @ApiProperty({
    type: EncryptedMessagePayloadDto,
    description: 'Encrypted message payload.',
  })
  @IsDefined()
  @ValidateNested()
  @Type(() => EncryptedMessagePayloadDto)
  message!: EncryptedMessagePayloadDto;
}
