import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class UpdateGroupChatDto {
  @ApiPropertyOptional({
    example: 'Updated Group Name',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Matches(/\S/)
  title?: string;
}
