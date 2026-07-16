import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsString } from 'class-validator';

export class MarkMessagesDeliveredDto {
  @ApiProperty({
    example: ['cm123message456', 'cm789message012'],
    description: 'Messages the current user device has received.',
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  messageIds: string[];
}
