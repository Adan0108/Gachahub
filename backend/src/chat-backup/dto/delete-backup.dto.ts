import { ApiProperty } from '@nestjs/swagger';
import { Equals } from 'class-validator';
import { BackupProofDto } from './backup-proof.dto';

export class DeleteBackupDto extends BackupProofDto {
  @ApiProperty({
    description:
      'Must be true. With a nonce and proof the backup is deleted at once; without them deletion is only scheduled',
  })
  @Equals(true)
  confirm!: true;
}
