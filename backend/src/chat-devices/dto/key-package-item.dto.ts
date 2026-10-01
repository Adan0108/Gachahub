import { ApiProperty } from '@nestjs/swagger';
import { IsBase64, IsEnum, IsNotEmpty, MaxLength } from 'class-validator';
import { MlsKeyPackageKind } from '../../generated/prisma/client';

export class KeyPackageItemDto {
  @ApiProperty({ enum: MlsKeyPackageKind })
  @IsEnum(MlsKeyPackageKind)
  kind!: MlsKeyPackageKind;

  @ApiProperty({
    description: 'Base64-encoded MLS KeyPackage wire bytes (mls_key_package)',
  })
  @IsNotEmpty()
  @IsBase64()
  @MaxLength(20000)
  payload!: string;
}
