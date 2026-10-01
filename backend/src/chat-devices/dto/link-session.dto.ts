import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class LinkSessionDto {
  @ApiProperty({
    description: 'The challenge the server issued for this login and device',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  challenge!: string;

  @ApiProperty({
    description:
      'Base64 Ed25519 signature of the challenge text, made with the device key',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  signature!: string;
}
