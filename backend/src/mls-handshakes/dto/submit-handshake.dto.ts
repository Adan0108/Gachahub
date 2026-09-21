import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBase64,
  IsInt,
  IsNotEmpty,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { WelcomeItemDto } from './welcome-item.dto';

export class SubmitHandshakeDto {
  @ApiProperty({ description: 'Device id submitting this Commit' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  deviceId!: string;

  @ApiProperty({ description: 'Epoch this Commit was built from' })
  @IsInt()
  @Min(0)
  epoch!: number;

  @ApiProperty({
    description: 'Base64-encoded MLS PrivateMessage (commit) wire bytes',
  })
  @IsNotEmpty()
  @IsBase64()
  @MaxLength(20000)
  payload!: string;

  @ApiProperty({
    type: [WelcomeItemDto],
    required: false,
    description: 'Welcomes for any devices newly added by this Commit',
  })
  @IsArray()
  @ArrayMaxSize(50)
  // Nothing else rejects the same recipientDeviceId appearing more than
  // once - without this, a client (buggy or malicious) submitting 50
  // duplicate entries would have all 50 accepted and stored as separate
  // mls_welcomes rows for the same device.
  @ArrayUnique((welcome: WelcomeItemDto) => welcome.recipientDeviceId)
  @ValidateNested({ each: true })
  @Type(() => WelcomeItemDto)
  welcomes: WelcomeItemDto[] = [];

  // Required, with no default: a client that leaves these out must be
  // refused, not treated as "this Commit changes no one" - the server checks
  // membership against what is declared here, and every other member's client
  // checks the declaration against the Commit itself.
  @ApiProperty({
    type: [String],
    description: 'Device ids this Commit adds - exactly the Welcome recipients',
  })
  @IsArray()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(64, { each: true })
  addedDeviceIds!: string[];

  @ApiProperty({
    type: [String],
    description: 'Device ids this Commit removes from the group',
  })
  @IsArray()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(64, { each: true })
  removedDeviceIds!: string[];
}
