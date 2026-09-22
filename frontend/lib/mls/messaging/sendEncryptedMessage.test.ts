import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sendEncryptedChatMessage } from './sendEncryptedMessage';
import { GroupStateUnavailableError } from '../contract/errors';

vi.mock('../../api', () => ({
  api: {
    sendChatMessage: vi.fn(),
  },
}));

function fakeSyncEngine() {
  return {
    getCurrentEpoch: vi.fn(),
    createGroup: vi.fn(),
    seedNewGroup: vi.fn(),
    encryptMessage: vi.fn(),
    reconcileMembership: vi.fn(),
  };
}

describe('sendEncryptedChatMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('encrypts, sends, and caches the plaintext when a group already exists', async () => {
    const { api } = await import('../../api');
    const engine = fakeSyncEngine();
    engine.getCurrentEpoch.mockResolvedValue(2);
    engine.encryptMessage.mockResolvedValue({ wireBytes: new Uint8Array([1, 2, 3]), epoch: 2 });
    vi.mocked(api.sendChatMessage).mockResolvedValue({
      message: { id: 'msg-1' },
    });

    const result = await sendEncryptedChatMessage(
      engine as any,
      'device-1',
      'conv-1',
      'user-bob',
      'hello',
      'client-1',
    );

    expect(engine.createGroup).not.toHaveBeenCalled();
    expect(engine.encryptMessage).toHaveBeenCalledWith('conv-1', {
      v: 1,
      type: 'text',
      body: 'hello',
    });
    expect(api.sendChatMessage).toHaveBeenCalledWith(
      'conv-1',
      expect.objectContaining({
        contentType: 'TEXT',
        clientMessageId: 'client-1',
        encryptionMeta: { senderDeviceId: 'device-1' },
      }),
    );
    expect(result.message.id).toBe('msg-1');
  });

  it('sets up the group first when this device has never established one', async () => {
    const { api } = await import('../../api');
    const engine = fakeSyncEngine();
    engine.getCurrentEpoch
      .mockRejectedValueOnce(new GroupStateUnavailableError('conv-1'))
      .mockResolvedValueOnce(0);
    engine.encryptMessage.mockResolvedValue({ wireBytes: new Uint8Array([1]), epoch: 0 });
    vi.mocked(api.sendChatMessage).mockResolvedValue({ message: { id: 'msg-2' } });

    await sendEncryptedChatMessage(
      engine as any,
      'device-1',
      'conv-1',
      'user-bob',
      'hi',
      'client-1',
    );

    expect(engine.createGroup).toHaveBeenCalledWith('conv-1');
    expect(engine.seedNewGroup).toHaveBeenCalledWith('conv-1', 'user-bob');
  });

  describe('when a member is still being removed', () => {
    const pendingError = () =>
      Object.assign(new Error('A member is being removed'), {
        status: 409,
        code: 'MEMBERSHIP_CHANGE_PENDING',
      });

    it('finishes the removal, then encrypts again under the new epoch and sends once more', async () => {
      const { api } = await import('../../api');
      const engine = fakeSyncEngine();
      engine.getCurrentEpoch.mockResolvedValue(2);
      engine.encryptMessage
        .mockResolvedValueOnce({ wireBytes: new Uint8Array([1]), epoch: 2 })
        .mockResolvedValueOnce({ wireBytes: new Uint8Array([2]), epoch: 3 });
      vi.mocked(api.sendChatMessage)
        .mockRejectedValueOnce(pendingError())
        .mockResolvedValueOnce({ message: { id: 'msg-9' } });

      const result = await sendEncryptedChatMessage(
        engine as any,
        'device-1',
        'conv-1',
        'user-bob',
        'hello',
        'client-1',
      );

      expect(engine.reconcileMembership).toHaveBeenCalledWith({ conversationId: 'conv-1' });
      expect(engine.encryptMessage).toHaveBeenCalledTimes(2);
      expect(api.sendChatMessage).toHaveBeenCalledTimes(2);
      // both sends carry the same id, so the backend can tell they are one message
      expect(
        vi.mocked(api.sendChatMessage).mock.calls.map(([, body]) => body.clientMessageId),
      ).toEqual(['client-1', 'client-1']);
      expect(result.message.id).toBe('msg-9');
    });

    it('only retries once - a second refusal is surfaced', async () => {
      const { api } = await import('../../api');
      const engine = fakeSyncEngine();
      engine.getCurrentEpoch.mockResolvedValue(2);
      engine.encryptMessage.mockResolvedValue({ wireBytes: new Uint8Array([1]), epoch: 2 });
      vi.mocked(api.sendChatMessage).mockRejectedValue(pendingError());

      await expect(
        sendEncryptedChatMessage(
          engine as any,
          'device-1',
          'conv-1',
          'user-bob',
          'hello',
          'client-1',
        ),
      ).rejects.toMatchObject({ code: 'MEMBERSHIP_CHANGE_PENDING' });

      expect(engine.reconcileMembership).toHaveBeenCalledTimes(1);
      expect(api.sendChatMessage).toHaveBeenCalledTimes(2);
    });

    it('does not reconcile or retry for any other failure', async () => {
      const { api } = await import('../../api');
      const engine = fakeSyncEngine();
      engine.getCurrentEpoch.mockResolvedValue(2);
      engine.encryptMessage.mockResolvedValue({ wireBytes: new Uint8Array([1]), epoch: 2 });
      vi.mocked(api.sendChatMessage).mockRejectedValue(
        Object.assign(new Error('duplicate'), { status: 409 }),
      );

      await expect(
        sendEncryptedChatMessage(
          engine as any,
          'device-1',
          'conv-1',
          'user-bob',
          'hello',
          'client-1',
        ),
      ).rejects.toThrow('duplicate');

      expect(engine.reconcileMembership).not.toHaveBeenCalled();
      expect(api.sendChatMessage).toHaveBeenCalledTimes(1);
    });
  });
});
