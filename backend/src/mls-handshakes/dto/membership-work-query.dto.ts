import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { ScopeQueryDto } from './scope-query.dto';

export class MembershipWorkQueryDto extends ScopeQueryDto {
  @ApiPropertyOptional({ description: 'Resume after this conversation id' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  after?: string;

  @ApiPropertyOptional({ description: 'Only work for this conversation' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  conversationId?: string;
}
