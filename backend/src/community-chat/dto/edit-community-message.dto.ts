import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { COMMUNITY_MESSAGE_MAX_CHARS } from '../community-chat.constants';

export class EditCommunityMessageDto {
  @ApiProperty({
    example: 'Anyone running the new banner tonight? (edit: at 9pm)',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(COMMUNITY_MESSAGE_MAX_CHARS)
  content!: string;
}
