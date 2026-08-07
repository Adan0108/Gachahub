import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class TransferGroupOwnershipDto {
    @ApiProperty({
        example: 'user-id-1',
        description: 'Active group member who will become the new owner.',
    })
    @IsString()
    newOwnerUserId!: string;
}