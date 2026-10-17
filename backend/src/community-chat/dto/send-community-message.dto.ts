import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { COMMUNITY_MESSAGE_MAX_CHARS } from '../community-chat.constants';

export class SendCommunityMessageDto {
  @ApiProperty({ example: 'Anyone running the new banner tonight?' })
  @IsString()
  @MinLength(1)
  @MaxLength(COMMUNITY_MESSAGE_MAX_CHARS)
  content!: string;

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
