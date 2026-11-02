import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsString,
  Length,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { MessageRequestSetting } from '../../generated/prisma/client';

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export const BIO_MAX_LENGTH = 160;

export class UpdateProfileDto {
  @ApiPropertyOptional({ description: 'Display name shown across the app.' })
  @ValidateIf((_, value) => value !== undefined)
  @Transform(trimmed)
  @IsString()
  @Length(2, 50)
  name?: string;

  @ApiPropertyOptional({
    description: 'A short line about you; an empty string clears it.',
  })
  @ValidateIf((_, value) => value !== undefined)
  @Transform(trimmed)
  @IsString()
  @MaxLength(BIO_MAX_LENGTH)
  bio?: string;

  @ApiPropertyOptional({
    enum: MessageRequestSetting,
    description: 'Who is allowed to start a new direct message with this user.',
  })
  @ValidateIf((_, value) => value !== undefined)
  @IsEnum(MessageRequestSetting)
  messageRequestSetting?: MessageRequestSetting;

  @ApiPropertyOptional({
    description:
      'Whether others see when you read their messages, and you see when they read yours.',
  })
  @ValidateIf((_, value) => value !== undefined)
  @IsBoolean()
  sendReadReceipts?: boolean;

  @ValidateIf((_, value) => value !== undefined)
  @IsBoolean()
  sendLinkPreviews?: boolean;
}
