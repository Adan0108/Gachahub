import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { MessageRequestSetting } from '../../generated/prisma/client';

export class UpdateProfileDto {
  @ApiPropertyOptional({
    enum: MessageRequestSetting,
    description: 'Who is allowed to start a new direct message with this user.',
  })
  @IsOptional()
  @IsEnum(MessageRequestSetting)
  messageRequestSetting?: MessageRequestSetting;
}
