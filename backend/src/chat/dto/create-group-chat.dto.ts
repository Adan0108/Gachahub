import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class CreateGroupChatDto {
  @ApiProperty({
    example: 'Wuthering Waves Team Build Chat',
  })
  @IsString()
  @MaxLength(120)
  @Matches(/\S/)
  title!: string;

  @ApiProperty({
    example: ['user-id-1', 'user-id-2'],
    description: 'Users to add besides the creator.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(99)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  memberUserIds!: string[];
}
