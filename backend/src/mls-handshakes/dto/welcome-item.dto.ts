import { ApiProperty } from '@nestjs/swagger';
import { IsBase64, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class WelcomeItemDto {
  @ApiProperty({ description: 'Device id that should receive this Welcome' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  recipientDeviceId!: string;

  @ApiProperty({ description: 'Base64-encoded MLS Welcome wire bytes' })
  @IsNotEmpty()
  @IsBase64()
  @MaxLength(20000)
  payload!: string;
}
