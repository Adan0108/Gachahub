import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsISO8601, IsOptional } from 'class-validator';

export class SetNotificationLevelDto {
  @ApiProperty({
    example: 'NOTHING',
    enum: ['ALL', 'NOTHING'],
    description:
      'ALL notifies on every message, NOTHING mutes this conversation.',
  })
  @IsIn(['ALL', 'NOTHING'])
  notificationLevel!: 'ALL' | 'NOTHING';

  @ApiPropertyOptional({
    example: '2026-08-17T20:00:00.000Z',
    description: 'Only used when NOTHING. Omit for an indefinite mute.',
  })
  @IsOptional()
  @IsISO8601()
  mutedUntil?: string;
}
