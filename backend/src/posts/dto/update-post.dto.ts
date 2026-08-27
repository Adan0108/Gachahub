import { PartialType, PickType } from '@nestjs/swagger';
import { CreatePostDto } from './create-post.dto';

/*
 * Không cho đổi gameId sau khi tạo.
 *
 * Nếu chuyển post sang game khác thì category hiện tại có thể không còn
 * thuộc đúng game, đồng thời moderation context cũng thay đổi.
 */
export class UpdatePostDto extends PartialType(
  PickType(CreatePostDto, [
    'categoryId',
    'title',
    'content',
    'type',
    'status',
    'visibility',
    'isSpoiler',
    'tags',
  ] as const),
) {}
