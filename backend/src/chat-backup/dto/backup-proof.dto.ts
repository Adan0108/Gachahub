import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBase64, IsOptional, IsString, MaxLength } from 'class-validator';
import { MAX_SECRET_BYTES } from '../chat-backup.constants';

const PROOF_MAX_LENGTH = Math.ceil((MAX_SECRET_BYTES * 4) / 3) + 4;

export class BackupProofDto {
  @ApiPropertyOptional({
    description: 'Nonce from GET /chat-backup/challenge',
  })
  @IsOptional()
  @IsString()
  @IsBase64()
  @MaxLength(PROOF_MAX_LENGTH)
  nonce?: string;

  @ApiPropertyOptional({
    description: 'Base64 HMAC proof of the current key over that nonce',
  })
  @IsOptional()
  @IsString()
  @IsBase64()
  @MaxLength(PROOF_MAX_LENGTH)
  proof?: string;
}
