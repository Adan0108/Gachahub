import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateGroupPhotoDto } from './update-group-photo.dto';

describe('UpdateGroupPhotoDto', () => {
  it('accepts an upload id', async () => {
    const dto = plainToInstance(UpdateGroupPhotoDto, {
      photoMediaUploadId: 'u1',
    });

    expect(await validate(dto)).toHaveLength(0);
  });

  it.each([
    ['missing', {}],
    ['empty', { photoMediaUploadId: '' }],
    ['null', { photoMediaUploadId: null }],
    ['not a string', { photoMediaUploadId: 5 }],
  ])('rejects %s', async (_label, body) => {
    const dto = plainToInstance(UpdateGroupPhotoDto, body);

    expect(await validate(dto)).not.toHaveLength(0);
  });
});
