import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { PostTypeDto } from '../../posts/dto/create-post.dto';

export enum GameFeedSortDto {
  LATEST = 'latest',
  TRENDING = 'trending',
}

export class QueryFeedDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: PostTypeDto,
    example: PostTypeDto.GUIDE,
  })
  @IsOptional()
  @IsEnum(PostTypeDto)
  type?: PostTypeDto;
}

export class QueryLatestFeedDto {
  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({
    description: 'Opaque continuation cursor returned by the previous page',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  cursor?: string;

  @ApiPropertyOptional({
    enum: PostTypeDto,
    example: PostTypeDto.GUIDE,
  })
  @IsOptional()
  @IsEnum(PostTypeDto)
  type?: PostTypeDto;
}

export class QueryGameFeedDto extends QueryFeedDto {
  @ApiPropertyOptional({
    enum: GameFeedSortDto,
    default: GameFeedSortDto.LATEST,
  })
  @IsOptional()
  @IsEnum(GameFeedSortDto)
  sort?: GameFeedSortDto = GameFeedSortDto.LATEST;

  @ApiPropertyOptional({
    example: 'builds',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  categorySlug?: string;

  @ApiPropertyOptional({
    description:
      'Opaque continuation cursor for latest sorting; ignored by trending sorting',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  cursor?: string;
}
