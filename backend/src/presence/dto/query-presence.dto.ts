import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsString } from 'class-validator';
import { MAX_PRESENCE_LOOKUP } from '../presence.constants';

export class QueryPresenceDto {
  @ApiProperty({
    example: 'user1,user2',
    description: `Comma separated user ids, up to ${MAX_PRESENCE_LOOKUP}.`,
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? [...new Set(value.split(',').filter(Boolean))]
      : value,
  )
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_PRESENCE_LOOKUP)
  @IsString({ each: true })
  userIds!: string[];
}
