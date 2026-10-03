import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { UpdateAvatarDto } from './update-avatar.dto';

describe('UpdateAvatarDto', () => {
  it('accepts an upload id', async () => {
    const dto = plainToInstance(UpdateAvatarDto, { avatarMediaUploadId: 'u1' });

    expect(await validate(dto)).toHaveLength(0);
  });

  it.each([
    ['missing', {}],
    ['empty', { avatarMediaUploadId: '' }],
    ['null', { avatarMediaUploadId: null }],
    ['not a string', { avatarMediaUploadId: 5 }],
  ])('rejects %s', async (_label, body) => {
    const dto = plainToInstance(UpdateAvatarDto, body);

    expect(await validate(dto)).not.toHaveLength(0);
  });
});
