import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { COMMUNITY_DELETE_REASON_MAX_CHARS } from '../community-chat.constants';

export class DeleteCommunityMessageDto {
  @ApiPropertyOptional({
    description:
      'Why a moderator removed it; kept with the message for review.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(COMMUNITY_DELETE_REASON_MAX_CHARS)
  reason?: string;
}
