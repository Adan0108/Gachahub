import { beforeEach, describe, expect, it, vi } from 'vitest';
import { claimDecrypt } from '../mls/messaging/decryptClaims';
import { decryptPendingMessages, type PendingMessageRow } from './backgroundDecrypt';

const row = (id: string, extra: Partial<PendingMessageRow> = {}): PendingMessageRow => ({
  id,
  senderId: 'peer',
  ciphertext: btoa(`wire-${id}`),
  ...extra,
});

const application = (body: string) => ({
  kind: 'application' as const,
  senderDeviceId: 'device-peer',
  epoch: 3,
  envelope: { v: 1, type: 'text', body },
});

describe('decryptPendingMessages', () => {
  const engine = {
    isAtCurrentEpoch: vi.fn(),
    syncCommits: vi.fn(),
    processIncoming: vi.fn(),
  };
  const store = { get: vi.fn(), save: vi.fn() };
  const run = (messages: PendingMessageRow[]) =>
    decryptPendingMessages({
      engine: engine as never,
      store: store as never,
      conversationId: 'c1' as never,
      messages,
      ownDeviceId: 'device-me',
      currentUserId: 'me',
    });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    engine.isAtCurrentEpoch.mockResolvedValue(true);
    engine.syncCommits.mockResolvedValue(3);
    engine.processIncoming.mockImplementation(async (_id: string, wire: Uint8Array) =>
      application(new TextDecoder().decode(wire)),
    );
    store.get.mockResolvedValue(undefined);
    store.save.mockResolvedValue(undefined);
  });

  it('decrypts every message it has not read yet, oldest first, and saves each one', async () => {
    await run([row('m1'), row('m2'), row('m3')]);

    expect(engine.processIncoming.mock.calls.map(([, wire]) => new TextDecoder().decode(wire as Uint8Array))).toEqual([
      'wire-m1',
      'wire-m2',
      'wire-m3',
    ]);
    expect(store.save.mock.calls.map(([saved]) => (saved as { messageId: string }).messageId)).toEqual([
      'm1',
      'm2',
      'm3',
    ]);
    expect(store.save).toHaveBeenCalledWith({
      messageId: 'm1',
      conversationId: 'c1',
      senderDeviceId: 'device-peer',
      epoch: 3,
      envelope: { v: 1, type: 'text', body: 'wire-m1' },
    });
  });

  it('leaves alone what is already saved on this device', async () => {
    store.get.mockImplementation(async (id: string) => (id === 'm1' ? { envelope: {} } : undefined));

    await run([row('m1'), row('m2')]);

    expect(engine.processIncoming).toHaveBeenCalledTimes(1);
    expect(store.save).toHaveBeenCalledWith(expect.objectContaining({ messageId: 'm2' }));
  });

  it('skips unsent messages and ones this device sent itself', async () => {
    await run([
      row('m1', { status: 'DELETED' }),
      row('m2', { senderId: 'me', encryptionMeta: { senderDeviceId: 'device-me' } }),
      row('m3', { senderId: 'me', encryptionMeta: { senderDeviceId: 'device-other' } }),
    ]);

    expect(store.save.mock.calls.map(([saved]) => (saved as { messageId: string }).messageId)).toEqual(['m3']);
  });

  it('does not touch a message another run is already decrypting', async () => {
    const release = claimDecrypt('m1')!;

    await run([row('m1'), row('m2')]);

    expect(store.save.mock.calls.map(([saved]) => (saved as { messageId: string }).messageId)).toEqual(['m2']);
    release();
  });

  it('lets go of every message when it is done, so the open chat can have any it missed', async () => {
    engine.processIncoming.mockRejectedValueOnce(new Error('bad key')).mockResolvedValue(application('ok'));

    await run([row('m1'), row('m2')]);

    for (const id of ['m1', 'm2']) {
      const release = claimDecrypt(id);
      expect(release).toBeTypeOf('function');
      release?.();
    }
  });

  it('catches up on commits first only when a message is behind', async () => {
    await run([row('m1')]);
    expect(engine.syncCommits).not.toHaveBeenCalled();

    engine.isAtCurrentEpoch.mockResolvedValue(false);
    await run([row('m2')]);
    expect(engine.syncCommits).toHaveBeenCalledWith('c1');
  });

  it('gives up quietly, leaving everything for the open chat, when catching up fails', async () => {
    engine.isAtCurrentEpoch.mockResolvedValue(false);
    engine.syncCommits.mockRejectedValue(new Error('no group'));

    await expect(run([row('m1'), row('m2')])).rejects.toThrow('no group');

    expect(engine.processIncoming).not.toHaveBeenCalled();
    for (const id of ['m1', 'm2']) {
      const release = claimDecrypt(id);
      expect(release).toBeTypeOf('function');
      release?.();
    }
  });

  it('keeps going after one message fails', async () => {
    engine.processIncoming.mockRejectedValueOnce(new Error('bad key')).mockResolvedValue(application('ok'));

    await run([row('m1'), row('m2')]);

    expect(store.save.mock.calls.map(([saved]) => (saved as { messageId: string }).messageId)).toEqual(['m2']);
  });

  it('saves nothing for a handshake that is not a message', async () => {
    engine.processIncoming.mockResolvedValue({ kind: 'commit' });

    await run([row('m1')]);

    expect(store.save).not.toHaveBeenCalled();
  });
});
