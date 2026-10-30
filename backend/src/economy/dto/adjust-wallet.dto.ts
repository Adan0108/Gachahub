import {
  IsIn,
  IsInt,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  NotEquals,
} from 'class-validator';

export const ADJUSTABLE_CURRENCIES = [
  'REPUTATION',
  'SHARDS',
  'PRISMS',
] as const;

export class AdjustWalletDto {
  @IsIn(ADJUSTABLE_CURRENCIES)
  currency!: (typeof ADJUSTABLE_CURRENCIES)[number];

  @IsInt()
  @NotEquals(0)
  @Min(-1_000_000)
  @Max(1_000_000)
  delta!: number;

  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}
