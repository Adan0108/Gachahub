import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBase64,
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { KeyPackageItemDto } from './key-package-item.dto';

export class RegisterDeviceDto {
  @ApiProperty({
    description:
      'Client-generated device id, embedded in every key package credential this device creates',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  deviceId!: string;

  @ApiProperty({ description: 'Base64-encoded raw MLS signature public key' })
  @IsNotEmpty()
  @IsBase64()
  @MaxLength(2000)
  signaturePublicKey!: string;

  @ApiProperty({ example: 'MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  ciphersuite!: string;

  @ApiProperty({ type: [KeyPackageItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => KeyPackageItemDto)
  keyPackages!: KeyPackageItemDto[];
}
