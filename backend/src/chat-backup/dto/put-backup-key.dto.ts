import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBase64,
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { BackupProofDto } from './backup-proof.dto';
import {
  MAX_KEY_CHECK_BYTES,
  MAX_SECRET_BYTES,
} from '../chat-backup.constants';

const base64Length = (bytes: number) => Math.ceil((bytes * 4) / 3) + 4;

export class PutBackupKeyDto extends BackupProofDto {
  @ApiProperty({
    description: 'Base64 encryption of a fixed string under the backup key',
  })
  @IsString()
  @IsBase64()
  @MaxLength(base64Length(MAX_KEY_CHECK_BYTES))
  keyCheck!: string;

  @ApiProperty({
    description:
      'Base64 secret derived from the backup key; kept to verify a later replace proof',
  })
  @IsString()
  @IsBase64()
  @MaxLength(base64Length(MAX_SECRET_BYTES))
  replaceSecret!: string;

  @ApiPropertyOptional({
    description:
      'Must be true to replace an existing key (deletes every stored blob)',
  })
  @IsOptional()
  @IsBoolean()
  replace?: boolean;
}
