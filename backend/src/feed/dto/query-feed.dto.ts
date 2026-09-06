import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
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
}
