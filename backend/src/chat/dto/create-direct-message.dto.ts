import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsString, ValidateNested } from 'class-validator';
import { EncryptedMessagePayloadDto } from './encrypted-message-payload.dto';

export class CreateDirectMessageDto {
  @ApiProperty({
    example: 'target-user-id',
    description: 'User receiving the direct message.',
  })
  @IsString()
  recipientUserId: string;

  @ApiProperty({
    type: EncryptedMessagePayloadDto,
    description: 'Encrypted first message payload.',
  })
  @ValidateNested()
  @Type(() => EncryptedMessagePayloadDto)
  message: EncryptedMessagePayloadDto;
}
