import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateGroupChatDto {
  @ApiPropertyOptional({
    example: 'Updated Group Name',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @ApiPropertyOptional({
    example: 'https://cdn.gachahub.com/chat/groups/new-photo.png',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  photoUrl?: string;
}
