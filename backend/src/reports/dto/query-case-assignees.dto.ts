import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class QueryCaseAssigneesDto {
  @ApiPropertyOptional({
    description:
      'Handle or name; under four characters matches exact handles only. Maximum ten results.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}
