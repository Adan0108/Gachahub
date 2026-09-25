import { describe, expect, it } from 'vitest';
import { TsMlsDeviceIdentityStore, TsMlsGroupSessionFactory } from './tsMlsAdapter';

async function aliceInvitesBob() {
  const aliceStore = new TsMlsDeviceIdentityStore();
  const bobStore = new TsMlsDeviceIdentityStore();
  await aliceStore.provision('user-alice');
  const bob = await bobStore.provision('user-bob');
  const [keyPackage] = await bobStore.generateKeyPackages(1, 'SINGLE_USE');
  const aliceGroup = await new TsMlsGroupSessionFactory(aliceStore).create('conv-1');
  const staged = await aliceGroup.stageCommit({
    added: [
      {
        credential: { userId: 'user-bob', deviceId: bob.deviceId, signatureKey: bob.signatureKey },
        keyPackage: keyPackage!,
      },
    ],
    removed: [],
  });
  const welcome = staged.welcome!;
  const singleUseCount = () =>
    [...bobStore.keyPackagesById.values()].filter((kp) => kp.kind === 'SINGLE_USE').length;
  return { bobFactory: new TsMlsGroupSessionFactory(bobStore), welcome, singleUseCount };
}

describe('joinFromWelcome key package spending', () => {
  it('runs onAccepted while the key package still exists, then spends it', async () => {
    const { bobFactory, welcome, singleUseCount } = await aliceInvitesBob();
    expect(singleUseCount()).toBe(1);
    let countDuringSave: number | undefined;

    await bobFactory.joinFromWelcome('conv-1', welcome.welcomeBytes, {
      onAccepted: async () => {
        countDuringSave = singleUseCount();
      },
    });

    expect(countDuringSave).toBe(1);
    expect(singleUseCount()).toBe(0);
  });

  it('keeps the key package when saving the join fails, so the Welcome can be retried', async () => {
    const { bobFactory, welcome, singleUseCount } = await aliceInvitesBob();

    await expect(
      bobFactory.joinFromWelcome('conv-1', welcome.welcomeBytes, {
        onAccepted: async () => {
          throw new Error('crash while saving');
        },
      }),
    ).rejects.toThrow('crash while saving');

    expect(singleUseCount()).toBe(1);
    await expect(bobFactory.joinFromWelcome('conv-1', welcome.welcomeBytes)).resolves.toBeDefined();
    expect(singleUseCount()).toBe(0);
  });
});
