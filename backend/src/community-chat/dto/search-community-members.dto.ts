import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class SearchCommunityMembersDto {
  @ApiPropertyOptional({
    description: 'What was typed after the @; omit to list a few members.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  q: string = '';
}
