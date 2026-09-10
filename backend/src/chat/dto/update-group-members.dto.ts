import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsString,
  MaxLength,
} from 'class-validator';

export class UpdateGroupMembersDto {
  @ApiProperty({
    example: ['user-id-1', 'user-id-2'],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(99)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  userIds!: string[];
}
