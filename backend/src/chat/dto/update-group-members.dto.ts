import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsString } from 'class-validator';

export class UpdateGroupMembersDto {
  @ApiProperty({
    example: ['user-id-1', 'user-id-2'],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(99)
  @IsString({ each: true })
  userIds!: string[];
}
