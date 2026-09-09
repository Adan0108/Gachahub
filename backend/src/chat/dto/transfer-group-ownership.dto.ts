import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

export class TransferGroupOwnershipDto {
  @ApiProperty({
    example: 'user-id-1',
    description: 'Active group member who will become the new owner.',
  })
  @IsString()
  @MaxLength(120)
  newOwnerUserId!: string;
}
