jest.mock('@thallesp/nestjs-better-auth', () => ({
  Session: () => () => undefined,
}));

import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateLinkPreviewDto } from './dto/create-link-preview.dto';
import { LinkPreviewsController } from './link-previews.controller';

const check = (value: unknown) =>
  validate(plainToInstance(CreateLinkPreviewDto, { url: value }));

describe('LinkPreviewsController', () => {
  it('asks the service about the signed-in user and the link', async () => {
    const service = {
      getPreview: jest.fn().mockResolvedValue({ title: 'A page' }),
    };
    const controller = new LinkPreviewsController(service as never);

    const result = await controller.create(
      { user: { id: 'user-1' } } as never,
      { url: 'https://example.com/' },
    );

    expect(service.getPreview).toHaveBeenCalledWith(
      'user-1',
      'https://example.com/',
    );
    expect(result).toEqual({ title: 'A page' });
  });
});

describe('CreateLinkPreviewDto', () => {
  it('accepts a link', async () => {
    await expect(check('https://example.com/a')).resolves.toHaveLength(0);
  });

  it.each([
    [undefined],
    [null],
    [''],
    [42],
    [{}],
    [['https://example.com']],
    ['x'.repeat(2049)],
  ])('rejects %p', async (value) => {
    expect((await check(value)).length).toBeGreaterThan(0);
  });

  it('accepts a link right at the limit', async () => {
    await expect(check('x'.repeat(2048))).resolves.toHaveLength(0);
  });
});
