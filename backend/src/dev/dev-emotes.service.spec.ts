import { InternalServerErrorException } from '@nestjs/common';
import { env } from '../config/env';
import { DevEmotesService } from './dev-emotes.service';

describe('DevEmotesService guard', () => {
  const original = env.nodeEnv;
  afterEach(() => {
    env.nodeEnv = original;
  });

  it('refuses to exist outside development', () => {
    env.nodeEnv = 'production';

    expect(() => new DevEmotesService({} as never, {} as never)).toThrow(
      InternalServerErrorException,
    );
  });
});

describe('DevEmotesService', () => {
  const CLOUD = 'gachahub-demo';
  const makeService = (
    existing: Record<string, string> = {},
    cloudName = CLOUD,
  ) => {
    env.nodeEnv = 'development';
    const prisma = {
      chatEmote: {
        findFirst: jest.fn(({ where }: { where: { shortcode: string } }) =>
          Promise.resolve(
            where.shortcode in existing
              ? {
                  id: `id-${where.shortcode}`,
                  imageUrl: existing[where.shortcode],
                }
              : null,
          ),
        ),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const cloudinary = {
      cloudName,
      uploadGeneratedImage: jest.fn(
        ({ folder, publicId }: { folder: string; publicId: string }) =>
          Promise.resolve({
            secureUrl: `https://res.cloudinary.com/${CLOUD}/image/upload/v1/${folder}/${publicId}.svg`,
            bytes: 321,
          }),
      ),
    };
    return {
      service: new DevEmotesService(prisma as never, cloudinary as never),
      prisma,
      cloudinary,
    };
  };
  const OWN = `https://res.cloudinary.com/${CLOUD}/image/upload/v1/dev-emotes/x.svg`;

  afterEach(() => {
    env.nodeEnv = 'development';
  });

  it('creates global emotes that are not there yet', async () => {
    const { service, prisma } = makeService();

    const result = await service.seedGlobalEmotes();

    expect(result.created).toEqual(['pity', 'lucky', 'salty', 'roll']);
    expect(result.existing).toEqual([]);
    expect(prisma.chatEmote.create).toHaveBeenCalledTimes(4);
  });

  it('can be run again without making duplicates or uploading again', async () => {
    const { service, prisma, cloudinary } = makeService({
      pity: OWN,
      lucky: OWN,
      salty: OWN,
      roll: OWN,
    });

    const result = await service.seedGlobalEmotes();

    expect(result.created).toEqual([]);
    expect(result.existing).toHaveLength(4);
    expect(prisma.chatEmote.create).not.toHaveBeenCalled();
    expect(cloudinary.uploadGeneratedImage).not.toHaveBeenCalled();
  });

  it('only creates the missing ones when some are there', async () => {
    const { service, prisma } = makeService({ pity: OWN });

    const result = await service.seedGlobalEmotes();

    expect(result.created).toEqual(['lucky', 'salty', 'roll']);
    expect(prisma.chatEmote.create).toHaveBeenCalledTimes(3);
  });

  it('stores global emotes with a Cloudinary picture, its real size, and nobody as the author', async () => {
    const { service, prisma } = makeService();

    await service.seedGlobalEmotes();

    const [{ data }] = prisma.chatEmote.create.mock.calls[0] as [
      { data: Record<string, unknown> },
    ];
    expect(data).toMatchObject({
      scope: 'GLOBAL',
      shortcode: 'pity',
      imageUrl: `https://res.cloudinary.com/${CLOUD}/image/upload/v1/dev-emotes/pity.svg`,
      width: 64,
      height: 64,
      mimeType: 'image/svg+xml',
      fileSize: 321,
    });
    expect(data).not.toHaveProperty('createdById');
    expect(data).not.toHaveProperty('gameId');
  });

  it('uploads a valid svg for each', async () => {
    const { service, cloudinary } = makeService();

    await service.seedGlobalEmotes();

    for (const [{ dataUri }] of cloudinary.uploadGeneratedImage.mock
      .calls as unknown as Array<[{ dataUri: string }]>) {
      const svg = Buffer.from(dataUri.split(',')[1], 'base64').toString('utf8');
      expect(svg.startsWith('<svg')).toBe(true);
      expect(svg.endsWith('</svg>')).toBe(true);
    }
  });

  it('moves an emote an earlier seed stored inline onto Cloudinary', async () => {
    const { service, prisma } = makeService({
      pity: 'data:image/svg+xml;base64,AAAA',
    });

    const result = await service.seedGlobalEmotes();

    expect(result.updated).toEqual(['pity']);
    expect(result.created).toEqual(['lucky', 'salty', 'roll']);
    const [{ where, data }] = prisma.chatEmote.update.mock.calls[0] as [
      { where: { id: string }; data: { imageUrl: string } },
    ];
    expect(where).toEqual({ id: 'id-pity' });
    expect(data.imageUrl).toContain('res.cloudinary.com');
  });

  it('refuses to store a picture that is not on our own account', async () => {
    const { service, prisma } = makeService({}, 'some-other-cloud');

    await expect(service.seedGlobalEmotes()).rejects.toThrow(
      InternalServerErrorException,
    );
    expect(prisma.chatEmote.create).not.toHaveBeenCalled();
  });
});
