import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { RateLimitedException } from '../common/exceptions/rate-limited.exception';
import { MAX_BLOB_BYTES, USER_QUOTA_BYTES } from './chat-backup.constants';
import { computeBackupProof } from './replace-proof';
import {
  ChatBackupService,
  decodeCursor,
  encodeCursor,
} from './chat-backup.service';

const b64 = (size: number) => Buffer.alloc(size, 7).toString('base64');
const item = (messageId: string, size = 32, conversationId = 'c1') => ({
  conversationId,
  messageId,
  ciphertext: b64(size),
});

const SECRET = Buffer.alloc(32, 9);
const NONCE = Buffer.alloc(32, 3).toString('base64');
const putDto = (extra: object = {}) => ({
  keyCheck: b64(40),
  replaceSecret: b64(32),
  ...extra,
});
const validProof = (dto = putDto()) =>
  computeBackupProof(SECRET, 'replace', {
    userId: 'u1',
    nonce: NONCE,
    keyCheck: dto.keyCheck,
    replaceSecret: dto.replaceSecret,
  }).toString('base64');
const actionProof = (action: 'delete' | 'cancel-delete', secret = SECRET) =>
  computeBackupProof(secret, action, { userId: 'u1', nonce: NONCE }).toString(
    'base64',
  );
const deleteDto = (extra: object = {}) => ({
  confirm: true as const,
  ...extra,
});
const DAY_MS = 24 * 60 * 60 * 1000;
const replaceDto = (proof?: string, dto = putDto()) => ({
  ...dto,
  replace: true,
  nonce: NONCE,
  proof: proof ?? validProof(dto),
});

describe('ChatBackupService', () => {
  const repository = {
    findKey: jest.fn(),
    createKey: jest.fn(),
    issueChallenge: jest.fn(),
    consumeChallenge: jest.fn(),
    replaceKey: jest.fn(),
    scheduleDeletion: jest.fn(),
    cancelDeletion: jest.fn(),
    deleteAll: jest.fn(),
    usage: jest.fn(),
    findMessagesInConversations: jest.fn(),
    findParticipatedConversations: jest.fn(),
    storeWithinQuota: jest.fn(),
    findPage: jest.fn(),
  };
  const rateLimiter = {
    assertCanUpload: jest.fn(),
    assertCanDownload: jest.fn(),
    assertCanManage: jest.fn(),
    assertCanDestroy: jest.fn(),
  };
  let service: ChatBackupService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new ChatBackupService(repository as never, rateLimiter as never);
    repository.findKey.mockResolvedValue({
      keyCheck: Buffer.alloc(40),
      replaceSecret: SECRET,
    });
    repository.findParticipatedConversations.mockResolvedValue(new Set(['c1']));
    repository.findMessagesInConversations.mockResolvedValue(
      new Set(['m1', 'm2']),
    );
    repository.usage.mockResolvedValue({ blobCount: 0, bytesUsed: 0 });
    repository.createKey.mockResolvedValue(true);
    repository.consumeChallenge.mockResolvedValue(true);
    repository.issueChallenge.mockResolvedValue(true);
    repository.storeWithinQuota.mockImplementation((_u, blobs: unknown[]) =>
      Promise.resolve({ status: 'stored', stored: blobs.length }),
    );
  });

  describe('getStatus', () => {
    it('reports disabled with no usage when there is no key', async () => {
      repository.findKey.mockResolvedValue(null);

      await expect(service.getStatus('u1')).resolves.toEqual({
        enabled: false,
        keyCheck: null,
        blobCount: 0,
        bytesUsed: 0,
      });
    });

    it('returns the key check and usage when enabled', async () => {
      repository.usage.mockResolvedValue({ blobCount: 3, bytesUsed: 99 });

      await expect(service.getStatus('u1')).resolves.toEqual({
        enabled: true,
        keyCheck: Buffer.alloc(40).toString('base64'),
        deletionScheduledFor: null,
        blobCount: 3,
        bytesUsed: 99,
      });
    });

    it('exposes the scheduled deletion date', async () => {
      const at = new Date('2026-10-01T00:00:00.000Z');
      repository.findKey.mockResolvedValue({
        keyCheck: Buffer.alloc(40),
        replaceSecret: SECRET,
        deletionScheduledAt: at,
      });

      await expect(service.getStatus('u1')).resolves.toMatchObject({
        deletionScheduledFor: '2026-10-01T00:00:00.000Z',
      });
    });
  });

  describe('putKey', () => {
    beforeEach(() => repository.findKey.mockResolvedValue(null));

    it('turns backup on when there is no key yet', async () => {
      await expect(service.putKey('u1', putDto())).resolves.toEqual({
        enabled: true,
      });

      expect(repository.createKey).toHaveBeenCalledWith(
        'u1',
        expect.any(Buffer),
        expect.any(Buffer),
      );
      expect(repository.replaceKey).not.toHaveBeenCalled();
    });

    it('reports a lost create race as a conflict', async () => {
      repository.createKey.mockResolvedValue(false);

      await expect(service.putKey('u1', putDto())).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('rejects a key check or secret of a silly size', async () => {
      await expect(
        service.putKey('u1', putDto({ keyCheck: b64(4) })),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.putKey('u1', putDto({ keyCheck: b64(1000) })),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.putKey('u1', putDto({ replaceSecret: b64(4) })),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('is rate limited', async () => {
      rateLimiter.assertCanManage.mockImplementation(() => {
        throw new RateLimitedException('slow', 5);
      });

      await expect(service.putKey('u1', putDto())).rejects.toBeInstanceOf(
        RateLimitedException,
      );
      expect(repository.createKey).not.toHaveBeenCalled();
    });

    describe('when a key already exists', () => {
      beforeEach(() =>
        repository.findKey.mockResolvedValue({
          keyCheck: Buffer.alloc(40),
          replaceSecret: SECRET,
        }),
      );

      it('refuses without the replace flag and touches nothing', async () => {
        await expect(service.putKey('u1', putDto())).rejects.toBeInstanceOf(
          ConflictException,
        );
        expect(repository.replaceKey).not.toHaveBeenCalled();
        expect(repository.consumeChallenge).not.toHaveBeenCalled();
      });

      it('refuses a replace with no proof', async () => {
        await expect(
          service.putKey('u1', { ...putDto(), replace: true }),
        ).rejects.toBeInstanceOf(ForbiddenException);
        expect(repository.replaceKey).not.toHaveBeenCalled();
      });

      it('replaces with a valid nonce and proof', async () => {
        await expect(service.putKey('u1', replaceDto())).resolves.toEqual({
          enabled: true,
        });

        expect(repository.consumeChallenge).toHaveBeenCalledWith(
          'u1',
          Buffer.from(NONCE, 'base64'),
          expect.any(Date),
        );
        expect(repository.replaceKey).toHaveBeenCalled();
      });

      it('refuses a wrong proof but still burns the nonce', async () => {
        await expect(
          service.putKey(
            'u1',
            replaceDto(Buffer.alloc(32, 1).toString('base64')),
          ),
        ).rejects.toBeInstanceOf(ForbiddenException);
        expect(repository.consumeChallenge).toHaveBeenCalled();
        expect(repository.replaceKey).not.toHaveBeenCalled();
      });

      it('refuses a proof made for different new values', async () => {
        const proof = validProof(putDto());

        await expect(
          service.putKey(
            'u1',
            replaceDto(proof, putDto({ keyCheck: b64(41) })),
          ),
        ).rejects.toBeInstanceOf(ForbiddenException);
        expect(repository.replaceKey).not.toHaveBeenCalled();
      });

      it('refuses a replayed, expired or unknown nonce', async () => {
        repository.consumeChallenge.mockResolvedValue(false);

        await expect(service.putKey('u1', replaceDto())).rejects.toBeInstanceOf(
          ForbiddenException,
        );
        expect(repository.replaceKey).not.toHaveBeenCalled();
      });

      it('refuses when the stored key predates proofs', async () => {
        repository.findKey.mockResolvedValue({
          keyCheck: Buffer.alloc(40),
          replaceSecret: null,
        });

        await expect(service.putKey('u1', replaceDto())).rejects.toBeInstanceOf(
          ForbiddenException,
        );
      });
    });
  });

  describe('issueChallenge', () => {
    it('issues a random nonce with a 5 minute expiry', async () => {
      const before = Date.now();
      const { nonce } = await service.issueChallenge('u1');

      expect(Buffer.from(nonce, 'base64')).toHaveLength(32);
      const [, , expiresAt] = repository.issueChallenge.mock.calls[0] as [
        string,
        Buffer,
        Date,
      ];
      expect(expiresAt.getTime() - before).toBeGreaterThanOrEqual(
        5 * 60_000 - 50,
      );
    });

    it('conflicts when backup is not on', async () => {
      repository.issueChallenge.mockResolvedValue(false);

      await expect(service.issueChallenge('u1')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('disable', () => {
    it('without a proof only schedules deletion 7 days out', async () => {
      const before = Date.now();
      const result = await service.disable('u1', deleteDto());

      expect(rateLimiter.assertCanDestroy).toHaveBeenCalledWith('u1');
      expect(repository.deleteAll).not.toHaveBeenCalled();
      const [, at] = repository.scheduleDeletion.mock.calls[0] as [
        string,
        Date,
      ];
      expect(at.getTime() - before).toBeGreaterThanOrEqual(7 * DAY_MS - 50);
      expect(at.getTime() - before).toBeLessThan(7 * DAY_MS + 5_000);
      expect(result).toEqual({
        enabled: true,
        deletionScheduledFor: at.toISOString(),
      });
    });

    it('keeps an existing schedule instead of pushing it back', async () => {
      const at = new Date('2026-10-01T00:00:00.000Z');
      repository.findKey.mockResolvedValue({
        keyCheck: Buffer.alloc(40),
        replaceSecret: SECRET,
        deletionScheduledAt: at,
      });

      await expect(service.disable('u1', deleteDto())).resolves.toEqual({
        enabled: true,
        deletionScheduledFor: at.toISOString(),
      });
      expect(repository.scheduleDeletion).toHaveBeenCalledWith('u1', at);
    });

    it('with a valid proof deletes at once', async () => {
      await expect(
        service.disable(
          'u1',
          deleteDto({ nonce: NONCE, proof: actionProof('delete') }),
        ),
      ).resolves.toEqual({ enabled: false, deletionScheduledFor: null });

      expect(repository.deleteAll).toHaveBeenCalledWith('u1');
      expect(repository.scheduleDeletion).not.toHaveBeenCalled();
    });

    it('refuses a wrong proof and deletes nothing', async () => {
      await expect(
        service.disable(
          'u1',
          deleteDto({
            nonce: NONCE,
            proof: actionProof('delete', Buffer.alloc(32, 1)),
          }),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(repository.deleteAll).not.toHaveBeenCalled();
      expect(repository.scheduleDeletion).not.toHaveBeenCalled();
    });

    it('refuses a replayed nonce', async () => {
      repository.consumeChallenge.mockResolvedValue(false);

      await expect(
        service.disable(
          'u1',
          deleteDto({ nonce: NONCE, proof: actionProof('delete') }),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repository.deleteAll).not.toHaveBeenCalled();
    });

    it('refuses a half proof instead of falling back to scheduling', async () => {
      await expect(
        service.disable('u1', deleteDto({ nonce: NONCE })),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repository.scheduleDeletion).not.toHaveBeenCalled();
    });

    it('refuses a proof made for another action', async () => {
      await expect(
        service.disable(
          'u1',
          deleteDto({ nonce: NONCE, proof: actionProof('cancel-delete') }),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repository.deleteAll).not.toHaveBeenCalled();
    });

    it('does nothing when there is no backup', async () => {
      repository.findKey.mockResolvedValue(null);

      await expect(service.disable('u1', deleteDto())).resolves.toEqual({
        enabled: false,
        deletionScheduledFor: null,
      });
      expect(repository.scheduleDeletion).not.toHaveBeenCalled();
    });

    it('does nothing when rate limited', async () => {
      rateLimiter.assertCanDestroy.mockImplementation(() => {
        throw new RateLimitedException('slow', 5);
      });

      await expect(service.disable('u1', deleteDto())).rejects.toBeInstanceOf(
        RateLimitedException,
      );
      expect(repository.deleteAll).not.toHaveBeenCalled();
      expect(repository.scheduleDeletion).not.toHaveBeenCalled();
    });
  });

  describe('cancelDeletion', () => {
    it('clears the schedule with a valid proof', async () => {
      await expect(
        service.cancelDeletion('u1', {
          nonce: NONCE,
          proof: actionProof('cancel-delete'),
        }),
      ).resolves.toEqual({ enabled: true, deletionScheduledFor: null });

      expect(repository.cancelDeletion).toHaveBeenCalledWith('u1');
    });

    it('refuses without a proof, with a wrong one, or with a delete proof', async () => {
      for (const dto of [
        {},
        {
          nonce: NONCE,
          proof: actionProof('cancel-delete', Buffer.alloc(32, 1)),
        },
        { nonce: NONCE, proof: actionProof('delete') },
      ]) {
        await expect(service.cancelDeletion('u1', dto)).rejects.toBeInstanceOf(
          ForbiddenException,
        );
      }
      expect(repository.cancelDeletion).not.toHaveBeenCalled();
    });

    it('conflicts when backup is not on', async () => {
      repository.findKey.mockResolvedValue(null);

      await expect(
        service.cancelDeletion('u1', {
          nonce: NONCE,
          proof: actionProof('cancel-delete'),
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('uploadBlobs', () => {
    it('stores new blobs and reports counts', async () => {
      await expect(
        service.uploadBlobs('u1', [item('m1'), item('m2')]),
      ).resolves.toEqual({ stored: 2, skipped: 0 });
    });

    it('refuses when backup is not on', async () => {
      repository.findKey.mockResolvedValue(null);

      await expect(
        service.uploadBlobs('u1', [item('m1')]),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('reports already stored ids as skipped', async () => {
      repository.storeWithinQuota.mockResolvedValue({
        status: 'stored',
        stored: 1,
      });

      await expect(
        service.uploadBlobs('u1', [item('m1'), item('m2')]),
      ).resolves.toEqual({ stored: 1, skipped: 1 });
    });

    it('checks and stores under the quota in one repository call', async () => {
      await service.uploadBlobs('u1', [item('m1', 10)]);

      expect(repository.storeWithinQuota).toHaveBeenCalledWith(
        'u1',
        [expect.objectContaining({ messageId: 'm1', size: 10 })],
        USER_QUOTA_BYTES,
      );
      expect(repository.usage).not.toHaveBeenCalled();
    });

    it('conflicts when backup was turned off during the upload', async () => {
      repository.storeWithinQuota.mockResolvedValue({ status: 'no-key' });

      await expect(
        service.uploadBlobs('u1', [item('m1')]),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects a blob over the per-blob cap', async () => {
      await expect(
        service.uploadBlobs('u1', [item('m1', MAX_BLOB_BYTES + 1)]),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('accepts a blob exactly at the cap', async () => {
      await expect(
        service.uploadBlobs('u1', [item('m1', MAX_BLOB_BYTES)]),
      ).resolves.toEqual({ stored: 1, skipped: 0 });
    });

    it('rejects a conversation the user never took part in', async () => {
      repository.findParticipatedConversations.mockResolvedValue(new Set());

      await expect(
        service.uploadBlobs('u1', [item('m1')]),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects a message id that is not in the claimed conversation', async () => {
      repository.findMessagesInConversations.mockResolvedValue(new Set());

      await expect(
        service.uploadBlobs('u1', [item('m1')]),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repository.storeWithinQuota).not.toHaveBeenCalled();
    });

    it('maps the repository quota verdict to 413', async () => {
      repository.storeWithinQuota.mockResolvedValue({ status: 'over-quota' });

      await expect(
        service.uploadBlobs('u1', [item('m1', 11)]),
      ).rejects.toBeInstanceOf(PayloadTooLargeException);
    });

    it('is rate limited before touching the database', async () => {
      rateLimiter.assertCanUpload.mockImplementation(() => {
        throw new RateLimitedException('slow', 5);
      });

      await expect(
        service.uploadBlobs('u1', [item('m1')]),
      ).rejects.toBeInstanceOf(RateLimitedException);
      expect(repository.findKey).not.toHaveBeenCalled();
    });
  });

  describe('listBlobs', () => {
    const row = (n: number) => ({
      id: `id${n}`,
      conversationId: 'c1',
      messageId: `m${n}`,
      ciphertext: Buffer.from([n]),
      createdAt: new Date(1000 * n),
    });

    it('returns a page and a cursor when there is more', async () => {
      repository.findPage.mockResolvedValue([row(1), row(2), row(3)]);

      const page = await service.listBlobs('u1', undefined, 2);

      expect(repository.findPage).toHaveBeenCalledWith('u1', null, 3);
      expect(page.items.map((i) => i.messageId)).toEqual(['m1', 'm2']);
      expect(decodeCursor(page.nextCursor as string)).toEqual({
        createdAt: new Date(2000),
        id: 'id2',
      });
    });

    it('has no cursor on the last page', async () => {
      repository.findPage.mockResolvedValue([row(1)]);

      await expect(
        service.listBlobs('u1', undefined, 2),
      ).resolves.toMatchObject({ nextCursor: null });
    });

    it('passes the decoded cursor to the repository', async () => {
      repository.findPage.mockResolvedValue([]);
      const cursor = { createdAt: new Date(5000), id: 'x' };

      await service.listBlobs('u1', encodeCursor(cursor));

      expect(repository.findPage).toHaveBeenCalledWith('u1', cursor, 101);
    });

    it('rejects a malformed cursor', async () => {
      await expect(service.listBlobs('u1', 'garbage')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });
});
