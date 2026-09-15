import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sendEncryptedChatMessage } from './sendEncryptedMessage';
import { GroupStateUnavailableError } from './errors';

vi.mock('../api', () => ({
  api: {
    sendChatMessage: vi.fn(),
  },
}));

function fakeSyncEngine() {
  return {
    getCurrentEpoch: vi.fn(),
    createGroup: vi.fn(),
    addUserToConversation: vi.fn(),
    encryptMessage: vi.fn(),
  };
}

describe('sendEncryptedChatMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('encrypts, sends, and caches the plaintext when a group already exists', async () => {
    const { api } = await import('../api');
    const engine = fakeSyncEngine();
    engine.getCurrentEpoch.mockResolvedValue(2);
    engine.encryptMessage.mockResolvedValue(new Uint8Array([1, 2, 3]));
    vi.mocked(api.sendChatMessage).mockResolvedValue({
      message: { id: 'msg-1' },
    });

    const result = await sendEncryptedChatMessage(
      engine as any,
      'device-1',
      'conv-1',
      'user-bob',
      'hello',
    );

    expect(engine.createGroup).not.toHaveBeenCalled();
    expect(engine.encryptMessage).toHaveBeenCalledWith('conv-1', {
      v: 1,
      type: 'text',
      body: 'hello',
    });
    expect(api.sendChatMessage).toHaveBeenCalledWith(
      'conv-1',
      expect.objectContaining({ contentType: 'TEXT' }),
    );
    expect(result.message.id).toBe('msg-1');
  });

  it('sets up the group first when this device has never established one', async () => {
    const { api } = await import('../api');
    const engine = fakeSyncEngine();
    engine.getCurrentEpoch
      .mockRejectedValueOnce(new GroupStateUnavailableError('conv-1'))
      .mockResolvedValueOnce(0);
    engine.encryptMessage.mockResolvedValue(new Uint8Array([1]));
    vi.mocked(api.sendChatMessage).mockResolvedValue({ message: { id: 'msg-2' } });

    await sendEncryptedChatMessage(engine as any, 'device-1', 'conv-1', 'user-bob', 'hi');

    expect(engine.createGroup).toHaveBeenCalledWith('conv-1');
    expect(engine.addUserToConversation).toHaveBeenCalledWith('conv-1', 'user-bob');
  });
});
