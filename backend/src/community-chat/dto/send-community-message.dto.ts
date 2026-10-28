import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import {
  COMMUNITY_MESSAGE_MAX_CHARS,
  COMMUNITY_MESSAGE_MAX_IMAGES,
} from '../community-chat.constants';

export class SendCommunityMessageDto {
  @ApiPropertyOptional({
    example: 'Anyone running the new banner tonight?',
    description: 'Required unless the message carries images.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(COMMUNITY_MESSAGE_MAX_CHARS)
  content?: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Confirmed COMMUNITY uploads to show with the message.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(COMMUNITY_MESSAGE_MAX_IMAGES)
  @ArrayUnique()
  @IsString({ each: true })
  mediaUploadIds?: string[];

  @ApiPropertyOptional({
    description: 'Message in the same channel this one replies to.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  replyToId?: string;

  @ApiPropertyOptional({
    description:
      'Client-made id, kept the same when a send is retried so it is posted once.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  clientMessageId?: string;
}
