import { ConflictException, Injectable } from '@nestjs/common';
import { MediaService } from '../../media/media.service';
import { UpdateAvatarDto } from './dto/update-avatar.dto';
import {
  AvatarConflictError,
  UserAvatarRepository,
} from './user-avatar.repository';

@Injectable()
export class UserAvatarService {
  constructor(
    private readonly userAvatarRepository: UserAvatarRepository,
    private readonly mediaService: MediaService,
  ) {}

  // The replaced asset is released best-effort after the new one commits; a failure is retried by MediaReleaseRetryService.
  async update(userId: string, dto: UpdateAvatarDto) {
    const upload = await this.mediaService.resolveSingleImage({
      id: dto.avatarMediaUploadId,
      userId,
      purpose: 'AVATAR',
      entityLabel: 'avatar',
    });

    return this.finish(() => this.userAvatarRepository.replace(userId, upload));
  }

  remove(userId: string) {
    return this.finish(() => this.userAvatarRepository.clear(userId));
  }

  private async finish(write: () => ReturnType<UserAvatarRepository['clear']>) {
    const { user, previousUploadId } = await write().catch((error: unknown) => {
      if (error instanceof AvatarConflictError) {
        throw new ConflictException(
          'Your avatar was changed elsewhere - please retry',
        );
      }
      throw error;
    });

    if (previousUploadId) {
      await this.mediaService.releaseReplacedUpload(previousUploadId);
    }

    return user;
  }
}
