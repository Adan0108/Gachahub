import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, ValidateIf } from 'class-validator';
import { MessageRequestSetting } from '../../generated/prisma/client';

export class UpdateProfileDto {
  @ApiPropertyOptional({
    enum: MessageRequestSetting,
    description: 'Who is allowed to start a new direct message with this user.',
  })
  @ValidateIf((_, value) => value !== undefined)
  @IsEnum(MessageRequestSetting)
  messageRequestSetting?: MessageRequestSetting;
}
