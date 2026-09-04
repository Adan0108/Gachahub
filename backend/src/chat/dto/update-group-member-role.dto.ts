import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

export class UpdateGroupMemberRoleDto {
  @ApiProperty({
    example: 'ADMIN',
    enum: ['ADMIN', 'MEMBER'],
    description:
      'New role for the member. Use transfer-ownership to change who owns the group.',
  })
  @IsIn(['ADMIN', 'MEMBER'])
  role!: 'ADMIN' | 'MEMBER';
}
