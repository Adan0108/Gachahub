import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sendEncryptedChatMessage, sendEncryptedEdit } from './sendEncryptedMessage';
import { EncryptedIndexedDbMessagePlaintextStore } from '../storage/messagePlaintextStore';
import { GroupStateUnavailableError } from '../contract/errors';

vi.mock('../../api', () => ({
  api: {
    sendChatMessage: vi.fn(),
    editChatMessage: vi.fn(),
  },
}));

function fakeSyncEngine() {
  return {
    getCurrentEpoch: vi.fn(),
    createGroup: vi.fn(),
    seedNewGroupWithMembers: vi.fn(),
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

  it('sends a link preview card inside the encrypted message and attaches its picture', async () => {
    const { api } = await import('../../api');
    const engine = fakeSyncEngine();
    engine.getCurrentEpoch.mockResolvedValue(2);
    engine.encryptMessage.mockResolvedValue({ wireBytes: new Uint8Array([1]), epoch: 2 });
    vi.mocked(api.sendChatMessage).mockResolvedValue({ message: { id: 'msg-3' } });
    const preview = {
      url: 'https://example.com/post',
      title: 'A post',
      thumb: { blob: 'upload-9', key: 'k', iv: 'i', sha256: 's', width: 320, height: 180 },
    };

    await sendEncryptedChatMessage(
      engine as any,
      'device-1',
      'conv-1',
      'user-bob',
      'look https://example.com/post',
      'client-1',
      undefined,
      preview,
    );

    expect(engine.encryptMessage).toHaveBeenCalledWith('conv-1', {
      v: 1,
      type: 'text',
      body: 'look https://example.com/post',
      previews: [preview],
    });
    expect(api.sendChatMessage).toHaveBeenCalledWith(
      'conv-1',
      expect.objectContaining({ media: [{ mediaUploadId: 'upload-9', sortOrder: 0 }] }),
    );
  });

  it('attaches nothing for a card with no picture', async () => {
    const { api } = await import('../../api');
    const engine = fakeSyncEngine();
    engine.getCurrentEpoch.mockResolvedValue(2);
    engine.encryptMessage.mockResolvedValue({ wireBytes: new Uint8Array([1]), epoch: 2 });
    vi.mocked(api.sendChatMessage).mockResolvedValue({ message: { id: 'msg-4' } });

    await sendEncryptedChatMessage(
      engine as any,
      'device-1',
      'conv-1',
      'user-bob',
      'look https://example.com/post',
      'client-1',
      undefined,
      { url: 'https://example.com/post', title: 'A post' },
    );

    const [, body] = vi.mocked(api.sendChatMessage).mock.calls[0]!;
    expect(body).not.toHaveProperty('media');
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
    expect(engine.seedNewGroupWithMembers).toHaveBeenCalledWith('conv-1', ['user-bob']);
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

describe('sendEncryptedEdit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('encrypts an edit envelope, submits it for the message, and caches it under the edit id', async () => {
    const { api } = await import('../../api');
    const engine = fakeSyncEngine();
    engine.getCurrentEpoch.mockResolvedValue(2);
    engine.encryptMessage.mockResolvedValue({ wireBytes: new Uint8Array([1, 2, 3]), epoch: 2 });
    vi.mocked(api.editChatMessage).mockResolvedValue({ message: { id: 'edit-9' } });

    const result = await sendEncryptedEdit(
      engine as any,
      'device-1',
      'conv-1',
      'user-bob',
      { targetMessageId: 'msg-1', text: 'fixed', n: 2 },
      'client-edit-1',
    );

    expect(engine.encryptMessage).toHaveBeenCalledWith('conv-1', {
      v: 1,
      type: 'edit',
      body: { targetMessageId: 'msg-1', text: 'fixed', n: 2 },
    });
    expect(api.editChatMessage).toHaveBeenCalledWith('msg-1', {
      ciphertext: expect.any(String),
      encryptionMeta: { senderDeviceId: 'device-1' },
      clientMessageId: 'client-edit-1',
    });
    expect(api.sendChatMessage).not.toHaveBeenCalled();
    expect(result.message.id).toBe('edit-9');

    const cached = await new EncryptedIndexedDbMessagePlaintextStore().get('edit-9');
    expect(cached?.envelope).toEqual({
      v: 1,
      type: 'edit',
      body: { targetMessageId: 'msg-1', text: 'fixed', n: 2 },
    });
  });

  it('catches up on a pending membership change and tries once more', async () => {
    const { api } = await import('../../api');
    const engine = fakeSyncEngine();
    engine.getCurrentEpoch.mockResolvedValue(2);
    engine.encryptMessage.mockResolvedValue({ wireBytes: new Uint8Array([1]), epoch: 2 });
    vi.mocked(api.editChatMessage)
      .mockRejectedValueOnce(Object.assign(new Error('pending'), { code: 'MEMBERSHIP_CHANGE_PENDING' }))
      .mockResolvedValueOnce({ message: { id: 'edit-10' } });

    await sendEncryptedEdit(
      engine as any,
      'device-1',
      'conv-1',
      'user-bob',
      { targetMessageId: 'msg-1', text: 'x', n: 1 },
      'client-edit-2',
    );

    expect(engine.reconcileMembership).toHaveBeenCalledWith({ conversationId: 'conv-1' });
    expect(api.editChatMessage).toHaveBeenCalledTimes(2);
  });

  it('does not hide other failures, such as the edit window having closed', async () => {
    const { api } = await import('../../api');
    const engine = fakeSyncEngine();
    engine.getCurrentEpoch.mockResolvedValue(2);
    engine.encryptMessage.mockResolvedValue({ wireBytes: new Uint8Array([1]), epoch: 2 });
    vi.mocked(api.editChatMessage).mockRejectedValue(Object.assign(new Error('too late'), { code: 'EDIT_WINDOW_CLOSED' }));

    await expect(
      sendEncryptedEdit(
        engine as any,
        'device-1',
        'conv-1',
        'user-bob',
        { targetMessageId: 'msg-1', text: 'x', n: 1 },
        'client-edit-3',
      ),
    ).rejects.toThrow('too late');
    expect(engine.reconcileMembership).not.toHaveBeenCalled();
  });
});
