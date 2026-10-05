import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { UsersRepository } from '../users.repository';
import { UpdateBannerDto } from './dto/update-banner.dto';
import { isBannerAvailable, PROFILE_BANNERS } from './profile-banner-catalog';

@Injectable()
export class UserBannerService {
  constructor(private readonly usersRepository: UsersRepository) {}

  list() {
    return PROFILE_BANNERS.map((banner) => ({
      ...banner,
      available: isBannerAvailable(banner),
    }));
  }

  async update(userId: string, dto: UpdateBannerDto) {
    const banner = PROFILE_BANNERS.find((b) => b.id === dto.bannerPresetId);

    if (!banner) {
      throw new BadRequestException('Unknown banner');
    }

    if (!isBannerAvailable(banner)) {
      throw new ForbiddenException('This banner is not available to you yet');
    }

    return this.usersRepository.setBannerPreset(userId, banner.id);
  }

  remove(userId: string) {
    return this.usersRepository.setBannerPreset(userId, null);
  }
}
