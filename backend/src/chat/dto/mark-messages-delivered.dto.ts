import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsString,
  MaxLength,
} from 'class-validator';

/**
 * Request body for acknowledging message delivery.
 *
 * Clients send this after syncing messages to a user device.
 * This is separate from read state bc a message can be delivered but not opened yet.
 */
export class MarkMessagesDeliveredDto {
  @ApiProperty({
    example: ['cm123message456', 'cm789message012'],
    description: 'Messages the current user device has received.',
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  messageIds!: string[];
}
