import type { PrismaService } from '../../prisma/prisma.service';

jest.mock('../../prisma/prisma.service', () => ({ PrismaService: class {} }));

import {
  AvatarConflictError,
  UserAvatarRepository,
} from './user-avatar.repository';

describe('UserAvatarRepository', () => {
  const tx = {
    user: {
      findUniqueOrThrow: jest.fn(),
      updateMany: jest.fn(),
    },
    mediaUpload: { updateMany: jest.fn() },
  };
  const prisma = { $transaction: jest.fn() };
  const repository = new UserAvatarRepository(
    prisma as unknown as PrismaService,
  );
  const upload = { id: 'upload-new', secureUrl: 'https://cdn/avatar.png' };

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation(
      (callback: (client: typeof tx) => unknown) => callback(tx),
    );
    tx.mediaUpload.updateMany.mockResolvedValue({ count: 1 });
    tx.user.updateMany.mockResolvedValue({ count: 1 });
  });

  // the first read is the CAS key, the second is the returned user
  function userRows(previousUploadId: string | null, image: string | null) {
    tx.user.findUniqueOrThrow
      .mockResolvedValueOnce({ avatarMediaUploadId: previousUploadId })
      .mockResolvedValueOnce({ id: 'user-1', image });
  }

  describe('replace', () => {
    it('claims the upload as an AVATAR owned by the user', async () => {
      userRows(null, upload.secureUrl);

      await repository.replace('user-1', upload);

      expect(tx.mediaUpload.updateMany).toHaveBeenCalledWith({
        where: {
          id: { in: ['upload-new'] },
          userId: 'user-1',
          purpose: 'AVATAR',
          status: 'UPLOADED',
        },
        data: expect.objectContaining({ status: 'ATTACHED' }) as unknown,
      });
    });

    it('writes image + upload id keyed on the previous upload id and returns it', async () => {
      userRows('upload-old', upload.secureUrl);

      const result = await repository.replace('user-1', upload);

      expect(tx.user.updateMany).toHaveBeenCalledWith({
        where: { id: 'user-1', avatarMediaUploadId: 'upload-old' },
        data: { image: upload.secureUrl, avatarMediaUploadId: 'upload-new' },
      });
      expect(result.previousUploadId).toBe('upload-old');
      expect(result.user).toEqual({ id: 'user-1', image: upload.secureUrl });
    });

    it('keys the swap on null for a first-ever avatar', async () => {
      userRows(null, upload.secureUrl);

      await repository.replace('user-1', upload);

      expect(tx.user.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1', avatarMediaUploadId: null },
        }),
      );
    });

    it('throws AvatarConflictError when another change won (CAS miss)', async () => {
      tx.user.findUniqueOrThrow.mockResolvedValueOnce({
        avatarMediaUploadId: 'upload-old',
      });
      tx.user.updateMany.mockResolvedValue({ count: 0 });

      await expect(repository.replace('user-1', upload)).rejects.toThrow(
        AvatarConflictError,
      );
    });

    it('fails before writing the user when the upload cannot be claimed', async () => {
      tx.mediaUpload.updateMany.mockResolvedValue({ count: 0 });

      await expect(repository.replace('user-1', upload)).rejects.toThrow(
        'could not be attached',
      );

      expect(tx.user.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('clear', () => {
    it('nulls image and upload id keyed on the current upload id', async () => {
      userRows('upload-old', null);

      const result = await repository.clear('user-1');

      expect(tx.user.updateMany).toHaveBeenCalledWith({
        where: { id: 'user-1', avatarMediaUploadId: 'upload-old' },
        data: { image: null, avatarMediaUploadId: null },
      });
      expect(result.previousUploadId).toBe('upload-old');
    });

    it('also clears a legacy image that has no backing upload', async () => {
      userRows(null, null);

      const result = await repository.clear('user-1');

      expect(tx.user.updateMany).toHaveBeenCalledWith({
        where: { id: 'user-1', avatarMediaUploadId: null },
        data: { image: null, avatarMediaUploadId: null },
      });
      expect(result.previousUploadId).toBeNull();
    });

    it('throws AvatarConflictError on a CAS miss', async () => {
      tx.user.findUniqueOrThrow.mockResolvedValueOnce({
        avatarMediaUploadId: 'upload-old',
      });
      tx.user.updateMany.mockResolvedValue({ count: 0 });

      await expect(repository.clear('user-1')).rejects.toThrow(
        AvatarConflictError,
      );
    });
  });
});
