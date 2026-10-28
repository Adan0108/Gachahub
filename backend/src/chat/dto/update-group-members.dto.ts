import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsString,
  MaxLength,
} from 'class-validator';
import { MAX_MEMBERS_PER_REQUEST } from '../group-size-policy';

export class UpdateGroupMembersDto {
  @ApiProperty({
    example: ['user-id-1', 'user-id-2'],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_MEMBERS_PER_REQUEST)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  userIds!: string[];
}
