import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { PostTypeDto } from './create-post.dto';

export enum PostSortDto {
  LATEST = 'latest',
  POPULAR = 'popular',
}

export class QueryPostsDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    example: 'wuthering-waves',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  gameSlug?: string;

  @ApiPropertyOptional({
    example: 'builds',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  categorySlug?: string;

  @ApiPropertyOptional({
    enum: PostTypeDto,
    example: PostTypeDto.GUIDE,
  })
  @IsOptional()
  @IsEnum(PostTypeDto)
  type?: PostTypeDto;

  @ApiPropertyOptional({
    example: 'Jinhsi',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({
    enum: PostSortDto,
    default: PostSortDto.LATEST,
  })
  @IsOptional()
  @IsEnum(PostSortDto)
  sort?: PostSortDto;
}
