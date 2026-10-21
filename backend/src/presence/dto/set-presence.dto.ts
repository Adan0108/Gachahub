import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import {
  INVISIBLE_DURATIONS,
  MY_PRESENCE_STATUSES,
  type InvisibleDuration,
  type MyPresenceStatus,
} from '../presence.constants';

export class SetPresenceDto {
  @ApiProperty({
    example: 'INVISIBLE',
    enum: MY_PRESENCE_STATUSES,
    description: 'ONLINE shows you when connected; INVISIBLE appears offline.',
  })
  @IsIn(MY_PRESENCE_STATUSES)
  status!: MyPresenceStatus;

  @ApiPropertyOptional({
    example: '1h',
    enum: INVISIBLE_DURATIONS,
    description: 'How long to stay invisible. Required for INVISIBLE.',
  })
  @IsOptional()
  @IsIn(INVISIBLE_DURATIONS)
  duration?: InvisibleDuration;
}
