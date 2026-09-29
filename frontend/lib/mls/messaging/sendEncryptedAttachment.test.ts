import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sendAttachmentsWithCache } from './sendEncryptedAttachment';
import type { AttachmentFile } from '../contract/types';

vi.mock('../../api', () => ({
  api: {
    sendChatMessage: vi.fn(),
    uploadChatBlobs: vi.fn(),
  },
}));

const KEY = 'A'.repeat(43) + '=';
const uploaded: AttachmentFile[] = [
  {
    name: 'a.bin',
    mime: 'application/octet-stream',
    size: 1,
    blob: 'up-1',
    key: KEY,
    iv: 'A'.repeat(16),
    sha256: KEY,
    thumb: { blob: 'up-2', key: KEY, iv: 'A'.repeat(16), sha256: KEY, width: 4, height: 4 },
  },
];

function params(cache: Map<string, Map<number, AttachmentFile>>, engine: unknown) {
  return {
    syncEngine: engine as never,
    deviceId: 'device-1',
    conversationId: 'conv-1',
    recipientUserId: 'user-bob',
    files: [new File(['x'], 'a.bin')],
    caption: ' hi ',
    clientMessageId: 'client-1',
    uploaded: cache,
  };
}

describe('sendAttachmentsWithCache', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends one attachment envelope with every blob id attached', async () => {
    const { api } = await import('../../api');
    const engine = {
      getCurrentEpoch: vi.fn().mockResolvedValue(1),
      encryptMessage: vi.fn().mockResolvedValue({ wireBytes: new Uint8Array([1]), epoch: 1 }),
    };
    vi.mocked(api.sendChatMessage).mockResolvedValue({ message: { id: 'msg-1' } });
    const cache = new Map([['client-1', new Map([[0, uploaded[0]!]])]]);

    await sendAttachmentsWithCache(params(cache, engine));

    expect(engine.encryptMessage).toHaveBeenCalledWith('conv-1', {
      v: 1,
      type: 'attachment',
      body: 'hi',
      files: uploaded,
    });
    expect(api.sendChatMessage).toHaveBeenCalledWith(
      'conv-1',
      expect.objectContaining({
        contentType: 'TEXT',
        media: [
          { mediaUploadId: 'up-1', sortOrder: 0 },
          { mediaUploadId: 'up-2', sortOrder: 1 },
        ],
      }),
    );
    expect(api.uploadChatBlobs).not.toHaveBeenCalled();
  });

  it('uploads once, then reuses the result when the send is retried', async () => {
    const { api } = await import('../../api');
    vi.mocked(api.uploadChatBlobs).mockResolvedValue(['up-1']);
    const engine = {
      getCurrentEpoch: vi.fn().mockResolvedValue(1),
      encryptMessage: vi
        .fn()
        .mockRejectedValueOnce(new Error('network'))
        .mockResolvedValue({ wireBytes: new Uint8Array([1]), epoch: 1 }),
    };
    vi.mocked(api.sendChatMessage).mockResolvedValue({ message: { id: 'msg-1' } });
    const cache = new Map<string, Map<number, AttachmentFile>>();

    await expect(sendAttachmentsWithCache(params(cache, engine))).rejects.toThrow('network');
    await sendAttachmentsWithCache(params(cache, engine));

    expect(api.uploadChatBlobs).toHaveBeenCalledTimes(1);
    expect(cache.get('client-1')?.size).toBe(1);
  });
});
