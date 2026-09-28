import { BadRequestException } from '@nestjs/common';
import { MediaService } from './media.service';

describe('MediaService opaque chat blobs', () => {
  const mediaRepository = {
    findById: jest.fn(),
    findManyByIds: jest.fn(),
    markDeleted: jest.fn(),
    markUploaded: jest.fn(),
    createInitiatedUpload: jest.fn(),
    countPendingOpaque: jest.fn(),
  };
  const cloudinaryService = {
    deleteAsset: jest.fn(),
    generateUploadSignature: jest.fn(),
    verifyUploadResponse: jest.fn(),
    getAsset: jest.fn(),
  };
  const redisService = { incrementWithExpiry: jest.fn() };

  let service: MediaService;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.CLOUDINARY_CLOUD_NAME = 'demo';
    process.env.CLOUDINARY_CHAT_BLOB_UPLOAD_PRESET = 'blob-preset';
    redisService.incrementWithExpiry.mockResolvedValue(1);
    cloudinaryService.generateUploadSignature.mockReturnValue({
      timestamp: 1,
      signature: 'sig',
    });
    mediaRepository.createInitiatedUpload.mockResolvedValue({ id: 'up-1' });
    mediaRepository.countPendingOpaque.mockResolvedValue(0);
    service = new MediaService(
      mediaRepository as any,
      cloudinaryService as any,
      redisService as any,
    );
  });

  describe('createUploadSignatures', () => {
    it('signs a raw upload into the opaque folder with the blob preset', async () => {
      const { items } = await service.createUploadSignatures(
        { purpose: 'CHAT', items: [{ opaqueKind: 'BLOB' }] } as any,
        'user-1',
      );

      expect(items[0].resourceType).toBe('raw');
      expect(items[0].uploadUrl).toBe(
        'https://api.cloudinary.com/v1_1/demo/raw/upload',
      );
      expect(items[0].folder).toBe('gachahub/chat-blob/user-1');
      expect(items[0].uploadPreset).toBe('blob-preset');
    });

    it('stores the opaque kind on the row', async () => {
      await service.createUploadSignatures(
        { purpose: 'CHAT', items: [{ opaqueKind: 'THUMB' }] } as any,
        'user-1',
      );

      expect(mediaRepository.createInitiatedUpload).toHaveBeenCalledWith(
        expect.objectContaining({ opaqueKind: 'THUMB' }),
      );
    });

    it('rejects a batch mixing opaque and plain items', async () => {
      await expect(
        service.createUploadSignatures(
          {
            purpose: 'CHAT',
            items: [{ opaqueKind: 'BLOB' }, { resourceType: 'IMAGE' }],
          } as any,
          'user-1',
        ),
      ).rejects.toThrow('cannot mix');
    });

    it('still enforces plain chat limits', async () => {
      await expect(
        service.createUploadSignatures(
          {
            purpose: 'CHAT',
            items: Array.from({ length: 5 }, () => ({ resourceType: 'IMAGE' })),
          } as any,
          'user-1',
        ),
      ).rejects.toThrow('up to four images');
    });

    it('caps unattached opaque uploads per user', async () => {
      mediaRepository.countPendingOpaque.mockResolvedValue(39);

      await expect(
        service.createUploadSignatures(
          {
            purpose: 'CHAT',
            items: [{ opaqueKind: 'BLOB' }, { opaqueKind: 'THUMB' }],
          } as any,
          'user-1',
        ),
      ).rejects.toThrow('Too many unattached');
      expect(mediaRepository.createInitiatedUpload).not.toHaveBeenCalled();
    });

    it('counts items, not requests, against the signature rate limit', async () => {
      await service.createUploadSignatures(
        {
          purpose: 'CHAT',
          items: [{ opaqueKind: 'BLOB' }, { opaqueKind: 'THUMB' }],
        } as any,
        'user-1',
      );

      expect(redisService.incrementWithExpiry).toHaveBeenCalledTimes(2);
    });

    it('rejects when an item pushes the counter over the limit', async () => {
      redisService.incrementWithExpiry
        .mockResolvedValueOnce(30)
        .mockResolvedValueOnce(31);

      await expect(
        service.createUploadSignatures(
          {
            purpose: 'CHAT',
            items: [{ opaqueKind: 'BLOB' }, { opaqueKind: 'THUMB' }],
          } as any,
          'user-1',
        ),
      ).rejects.toThrow('Too many upload');
    });

    it('rejects opaque items outside chat', async () => {
      await expect(
        service.createUploadSignatures(
          { purpose: 'POST', items: [{ opaqueKind: 'BLOB' }] } as any,
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an item with both or neither of resourceType/opaqueKind', async () => {
      for (const item of [{}, { resourceType: 'IMAGE', opaqueKind: 'BLOB' }]) {
        await expect(
          service.createUploadSignatures(
            { purpose: 'CHAT', items: [item] } as any,
            'user-1',
          ),
        ).rejects.toThrow(BadRequestException);
      }
    });
  });

  describe('confirmUploads', () => {
    const confirmDto = (overrides: Record<string, unknown> = {}) => ({
      items: [
        {
          uploadId: 'up-1',
          assetId: 'asset-1',
          publicId: 'gachahub/chat-blob/user-1/abc',
          secureUrl:
            'https://res.cloudinary.com/demo/raw/upload/v1/gachahub/chat-blob/user-1/abc',
          version: 1,
          signature: 'sig',
          bytes: 1000,
          ...overrides,
        },
      ],
    });

    beforeEach(() => {
      mediaRepository.findById.mockResolvedValue({
        id: 'up-1',
        userId: 'user-1',
        status: 'INITIATED',
        resourceType: 'IMAGE',
        publicId: 'gachahub/chat-blob/user-1/abc',
      });
      cloudinaryService.verifyUploadResponse.mockReturnValue(true);
      cloudinaryService.getAsset.mockResolvedValue({
        asset_id: 'asset-1',
        resource_type: 'raw',
        bytes: 1000,
      });
      mediaRepository.markUploaded.mockResolvedValue({
        id: 'up-1',
        purpose: 'CHAT',
        resourceType: 'IMAGE',
        status: 'UPLOADED',
        secureUrl: 'x',
        width: null,
        height: null,
        duration: null,
      });
    });

    it('accepts a raw blob without format/width/height', async () => {
      const result = await service.confirmUploads(confirmDto(), 'user-1');

      expect(result.successfulCount).toBe(1);
      expect(mediaRepository.markUploaded).toHaveBeenCalledWith(
        expect.objectContaining({ format: 'bin' }),
      );
    });

    it('enforces the per-kind size cap', async () => {
      const result = await service.confirmUploads(
        confirmDto({ bytes: 26 * 1024 * 1024 }),
        'user-1',
      );

      expect(result.failedCount).toBe(1);
      expect(mediaRepository.markUploaded).not.toHaveBeenCalled();
    });

    it('rejects a non-raw delivery URL', async () => {
      const result = await service.confirmUploads(
        confirmDto({
          secureUrl: 'https://res.cloudinary.com/demo/image/upload/v1/a',
        }),
        'user-1',
      );

      expect(result.failedCount).toBe(1);
    });

    const base = 'https://res.cloudinary.com/demo';
    const path = 'gachahub/chat-blob/user-1/abc';

    it.each([
      [
        'a different cloud',
        `https://res.cloudinary.com/evil/raw/upload/v1/${path}`,
      ],
      ['a wrong version', `${base}/raw/upload/v2/${path}`],
      ['a path suffix', `${base}/raw/upload/v1/${path}/x`],
      ['a query string', `${base}/raw/upload/v1/${path}?x=1`],
      ['a /raw/ substring', `${base}/image/upload/v1/raw/${path}`],
    ])('rejects %s in the delivery URL', async (_label, secureUrl) => {
      const result = await service.confirmUploads(
        confirmDto({ secureUrl }),
        'user-1',
      );

      expect(result.failedCount).toBe(1);
      expect(cloudinaryService.getAsset).not.toHaveBeenCalled();
    });

    it('rejects when Cloudinary reports more bytes than the cap', async () => {
      cloudinaryService.getAsset.mockResolvedValue({
        asset_id: 'asset-1',
        resource_type: 'raw',
        bytes: 30 * 1024 * 1024,
      });

      const result = await service.confirmUploads(confirmDto(), 'user-1');

      expect(result.failedCount).toBe(1);
      expect(mediaRepository.markUploaded).not.toHaveBeenCalled();
    });

    it('rejects a non-raw or mismatched asset', async () => {
      for (const asset of [
        { asset_id: 'asset-1', resource_type: 'image', bytes: 10 },
        { asset_id: 'other', resource_type: 'raw', bytes: 10 },
      ]) {
        cloudinaryService.getAsset.mockResolvedValue(asset);

        const result = await service.confirmUploads(confirmDto(), 'user-1');

        expect(result.failedCount).toBe(1);
      }
    });

    it('fails without storing when Cloudinary cannot be reached', async () => {
      cloudinaryService.getAsset.mockRejectedValue(new Error('down'));

      const result = await service.confirmUploads(confirmDto(), 'user-1');

      expect(result.failed[0].statusCode).toBe(503);
      expect(mediaRepository.markUploaded).not.toHaveBeenCalled();
    });

    it('treats a stored opaqueKind as opaque regardless of folder', async () => {
      mediaRepository.findById.mockResolvedValue({
        id: 'up-1',
        userId: 'user-1',
        status: 'INITIATED',
        resourceType: 'IMAGE',
        opaqueKind: 'BLOB',
        publicId: path,
      });

      const result = await service.confirmUploads(confirmDto(), 'user-1');

      expect(result.successfulCount).toBe(1);
    });

    it('still requires a format for regular media', async () => {
      mediaRepository.findById.mockResolvedValue({
        id: 'up-1',
        userId: 'user-1',
        status: 'INITIATED',
        resourceType: 'IMAGE',
        publicId: 'gachahub/chat/user-1/abc',
      });

      const result = await service.confirmUploads(
        confirmDto({ publicId: 'gachahub/chat/user-1/abc' }),
        'user-1',
      );

      expect(result.failedCount).toBe(1);
    });
  });

  describe('release', () => {
    it('destroys opaque blobs as raw assets', async () => {
      mediaRepository.findById.mockResolvedValue({
        id: 'up-1',
        status: 'ATTACHED',
        publicId: 'gachahub/chat-thumb/user-1/abc',
        resourceType: 'IMAGE',
      });

      await service.destroyAttachedCloudinaryAsset('up-1');

      expect(cloudinaryService.deleteAsset).toHaveBeenCalledWith(
        'gachahub/chat-thumb/user-1/abc',
        'raw',
      );
    });
  });

  describe('resolveAttachableMedia', () => {
    type Kind = 'chat-blob' | 'chat-thumb' | 'chat';
    const upload = (id: string, kind: Kind, opaqueKind?: string) => ({
      opaqueKind: opaqueKind ?? null,
      id,
      userId: 'user-1',
      purpose: 'CHAT',
      status: 'UPLOADED',
      resourceType: 'IMAGE',
      publicId: `gachahub/${kind}/user-1/${id}`,
      assetId: id,
      secureUrl: 'https://res.cloudinary.com/demo/raw/upload/x',
      format: 'bin',
      bytes: 10,
    });
    const resolve = (uploads: ReturnType<typeof upload>[], max?: number) => {
      mediaRepository.findManyByIds.mockResolvedValue(uploads);

      return service.resolveAttachableMedia({
        ids: uploads.map((u) => u.id),
        userId: 'user-1',
        purpose: 'CHAT',
        maxImages: 4,
        maxVideos: 1,
        maxOpaqueBlobs: max,
        entityLabel: 'chat message',
      });
    };

    it('accepts blobs with thumbnails up to the cap', async () => {
      const uploads = [upload('a', 'chat-blob'), upload('b', 'chat-thumb')];

      await expect(resolve(uploads, 10)).resolves.toHaveLength(2);
    });

    it('rejects more blobs than allowed', async () => {
      const uploads = [upload('a', 'chat-blob'), upload('b', 'chat-blob')];

      await expect(resolve(uploads, 1)).rejects.toThrow('at most 1 encrypted');
    });

    it('rejects thumbnails outnumbering blobs', async () => {
      const uploads = [
        upload('a', 'chat-blob'),
        upload('b', 'chat-thumb'),
        upload('c', 'chat-thumb'),
      ];

      await expect(resolve(uploads, 10)).rejects.toThrow('thumbnails');
    });

    it('rejects mixing opaque and plain media', async () => {
      const uploads = [upload('a', 'chat-blob'), upload('b', 'chat')];

      await expect(resolve(uploads, 10)).rejects.toThrow('cannot mix');
    });

    it('reads the stored opaqueKind column', async () => {
      const row = upload('a', 'chat', 'BLOB');

      await expect(resolve([row], 10)).resolves.toHaveLength(1);
    });

    it('rejects opaque blobs for callers that do not opt in', async () => {
      await expect(resolve([upload('a', 'chat-blob')])).rejects.toThrow(
        'does not support',
      );
    });
  });
});
