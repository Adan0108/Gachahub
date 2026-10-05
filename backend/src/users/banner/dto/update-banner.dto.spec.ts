import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { PROFILE_BANNER_IDS } from '../profile-banner-catalog';
import { UpdateBannerDto } from './update-banner.dto';

describe('UpdateBannerDto', () => {
  it('accepts a catalog id', async () => {
    const dto = plainToInstance(UpdateBannerDto, {
      bannerPresetId: PROFILE_BANNER_IDS[0],
    });

    expect(await validate(dto)).toHaveLength(0);
  });

  it.each([
    ['missing', {}],
    ['null', { bannerPresetId: null }],
    ['unknown id', { bannerPresetId: 'not-a-banner' }],
    ['not a string', { bannerPresetId: 3 }],
  ])('rejects %s', async (_label, body) => {
    const dto = plainToInstance(UpdateBannerDto, body);

    expect(await validate(dto)).not.toHaveLength(0);
  });
});
