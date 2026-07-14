import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ValidateNested } from 'class-validator';
import { EncryptedMessagePayloadDto } from './encrypted-message-payload.dto';

export class SendMessageDto {
  @ApiProperty({
    type: EncryptedMessagePayloadDto,
    description: 'Encrypted message payload.',
  })
  @ValidateNested()
  @Type(() => EncryptedMessagePayloadDto)
  message: EncryptedMessagePayloadDto;
}
