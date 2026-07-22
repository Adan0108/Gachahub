import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export enum PostTypeDto {
  GENERAL = 'GENERAL',
  GUIDE = 'GUIDE',
  BUILD = 'BUILD',
  TEAM = 'TEAM',
  LORE = 'LORE',
  THEORY = 'THEORY',
  QUESTION = 'QUESTION',
  NEWS = 'NEWS',
  MEME = 'MEME',
}

export enum PostVisibilityDto {
  PUBLIC = 'PUBLIC',
  FOLLOWERS_ONLY = 'FOLLOWERS_ONLY',
  PRIVATE = 'PRIVATE',
}

export enum CreatePostStatusDto {
  DRAFT = 'DRAFT',
  PUBLISHED = 'PUBLISHED',
}

export enum PostMediaTypeDto {
  IMAGE = 'IMAGE',
  GIF = 'GIF',
  VIDEO = 'VIDEO',
}

export class CreatePostMediaDto {
  @ApiProperty({
    example: 'https://res.cloudinary.com/example/image/upload/post-image.png',
  })
  @IsUrl()
  url!: string;

  @ApiPropertyOptional({
    example: 'gachahub/posts/abc123',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  publicId?: string;

  @ApiProperty({
    enum: PostMediaTypeDto,
    example: PostMediaTypeDto.IMAGE,
  })
  @IsEnum(PostMediaTypeDto)
  mediaType!: PostMediaTypeDto;

  @ApiPropertyOptional({
    example: 'Jinhsi build statistics',
  })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  altText?: string;

  @ApiPropertyOptional({
    example: 0,
    default: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class CreatePostDto {
  @ApiProperty({
    example: 'game_id',
  })
  @IsString()
  gameId!: string;

  @ApiPropertyOptional({
    example: 'category_id',
  })
  @IsOptional()
  @IsString()
  categoryId?: string;

  @ApiProperty({
    example: 'Beginner Jinhsi build guide',
  })
  @IsString()
  @MinLength(3)
  @MaxLength(255)
  title!: string;

  @ApiProperty({
    example:
      'This build focuses on critical damage and resonance skill damage.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(30000)
  content!: string;

  @ApiPropertyOptional({
    enum: PostTypeDto,
    default: PostTypeDto.GENERAL,
  })
  @IsOptional()
  @IsEnum(PostTypeDto)
  type?: PostTypeDto;

  @ApiPropertyOptional({
    enum: CreatePostStatusDto,
    default: CreatePostStatusDto.PUBLISHED,
  })
  @IsOptional()
  @IsEnum(CreatePostStatusDto)
  status?: CreatePostStatusDto;

  @ApiPropertyOptional({
    enum: PostVisibilityDto,
    default: PostVisibilityDto.PUBLIC,
  })
  @IsOptional()
  @IsEnum(PostVisibilityDto)
  visibility?: PostVisibilityDto;

  @ApiPropertyOptional({
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  isSpoiler?: boolean;

  @ApiPropertyOptional({
    type: [CreatePostMediaDto],
    maxItems: 10,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => CreatePostMediaDto)
  media?: CreatePostMediaDto[];

  @ApiPropertyOptional({
    type: [String],
    maxItems: 10,
    example: ['Jinhsi', 'Beginner', 'Build'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(80, { each: true })
  tags?: string[];
}
