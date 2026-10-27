import { ConflictException, Injectable } from '@nestjs/common';
import { MediaService } from '../media/media.service';
import { ChatAccessService } from './chat-access.service';
import {
  ChatGroupPhotoRepository,
  GroupPhotoConflictError,
} from './chat-group-photo.repository';
import { UpdateGroupPhotoDto } from './dto/update-group-photo.dto';

/** A group's picture: an uploaded image that owners and admins can replace or remove, releasing the old one. */
@Injectable()
export class ChatGroupPhotoService {
  constructor(
    private readonly chatAccessService: ChatAccessService,
    private readonly repository: ChatGroupPhotoRepository,
    private readonly mediaService: MediaService,
  ) {}

  // The replaced asset is released best-effort after the new one commits; a failure is retried by MediaReleaseRetryService.
  async update(
    userId: string,
    conversationId: string,
    dto: UpdateGroupPhotoDto,
  ) {
    await this.chatAccessService.assertIsGroupMember(userId, conversationId);
    const upload = await this.mediaService.resolveSingleImage({
      id: dto.photoMediaUploadId,
      userId,
      purpose: 'GROUP_PHOTO',
      entityLabel: 'group photo',
    });

    return this.finish(() =>
      this.repository.replace(conversationId, userId, upload),
    );
  }

  async remove(userId: string, conversationId: string) {
    await this.chatAccessService.assertIsGroupMember(userId, conversationId);

    return this.finish(() => this.repository.clear(conversationId, userId));
  }

  private async finish(
    write: () => ReturnType<ChatGroupPhotoRepository['clear']>,
  ) {
    const { conversation, previousUploadId } = await write().catch(
      (error: unknown) => {
        if (error instanceof GroupPhotoConflictError) {
          throw new ConflictException(
            'The group photo was changed elsewhere - please retry',
          );
        }
        throw error;
      },
    );

    if (previousUploadId) {
      await this.mediaService.releaseReplacedUpload(previousUploadId);
    }

    return conversation;
  }
}
