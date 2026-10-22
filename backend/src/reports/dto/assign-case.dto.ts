import { IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AssignCaseDto {
  @ApiProperty({
    description: 'Eligible moderator selected from the assignee picker.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  assigneeId: string;
}
