import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { KeyPackageItemDto } from './key-package-item.dto';

export class UploadKeyPackagesDto {
  @ApiProperty({ type: [KeyPackageItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => KeyPackageItemDto)
  keyPackages!: KeyPackageItemDto[];
}
