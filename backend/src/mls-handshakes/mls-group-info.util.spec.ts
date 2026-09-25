import { BadRequestException } from '@nestjs/common';
import { decodeMlsMessage, encodeMlsMessage, type GroupInfo } from 'ts-mls';
import {
  assertGroupInfoSignedBy,
  assertIsGroupInfoFor,
} from './mls-group-info.util';
import { buildTestExternalJoin } from './test-support/build-test-external-join';

describe('assertIsGroupInfoFor', () => {
  let groupInfo: Uint8Array;
  let commit: Uint8Array;
  let epoch: number;

  beforeAll(async () => {
    const join = await buildTestExternalJoin('conv-1', {
      userId: 'user-2',
      deviceId: 'device-2',
    });
    groupInfo = join.groupInfoPayload;
    commit = join.commitPayload;
    epoch = join.epoch;
  });

  it('accepts a GroupInfo for the conversation and epoch it describes', () => {
    expect(() =>
      assertIsGroupInfoFor(groupInfo, 'conv-1', epoch),
    ).not.toThrow();
  });

  it('refuses a GroupInfo of another conversation', () => {
    expect(() => assertIsGroupInfoFor(groupInfo, 'conv-2', epoch)).toThrow(
      'group_id does not match',
    );
  });

  it('refuses a GroupInfo for another epoch', () => {
    expect(() => assertIsGroupInfoFor(groupInfo, 'conv-1', epoch + 1)).toThrow(
      'epoch is not the epoch',
    );
  });

  it('refuses an MLS message that is not a GroupInfo', () => {
    expect(() => assertIsGroupInfoFor(commit, 'conv-1', epoch)).toThrow(
      'Expected an MLS GroupInfo',
    );
  });

  it('refuses bytes that are not an MLS message at all', () => {
    expect(() =>
      assertIsGroupInfoFor(new Uint8Array([1]), 'conv-1', 0),
    ).toThrow(BadRequestException);
  });
});

describe('assertGroupInfoSignedBy', () => {
  let signed: Uint8Array;
  let signerKey: Uint8Array;

  beforeAll(async () => {
    const join = await buildTestExternalJoin('conv-1', {
      userId: 'user-2',
      deviceId: 'device-2',
    });
    signed = join.nextGroupInfoPayload;
    signerKey = join.joinerSignatureKey;
  });

  function rebuilt(edit: (info: GroupInfo) => void): Uint8Array {
    const message = decodeMlsMessage(signed, 0)![0];
    if (message.wireformat !== 'mls_group_info') throw new Error('fixture');
    edit(message.groupInfo);
    return encodeMlsMessage(message);
  }

  it('accepts a snapshot signed by the publisher leaf', async () => {
    await expect(
      assertGroupInfoSignedBy(signed, signerKey),
    ).resolves.toBeUndefined();
  });

  it('refuses a tampered signature', async () => {
    const tampered = rebuilt((info) => {
      info.signature = info.signature.slice();
      info.signature[0] ^= 1;
    });
    await expect(assertGroupInfoSignedBy(tampered, signerKey)).rejects.toThrow(
      'signature is invalid',
    );
  });

  it('refuses a snapshot whose signer leaf is another device', async () => {
    const other = (
      await buildTestExternalJoin('conv-1', {
        userId: 'user-3',
        deviceId: 'device-3',
      })
    ).joinerSignatureKey;
    await expect(assertGroupInfoSignedBy(signed, other)).rejects.toThrow(
      'not the publisher',
    );
  });

  it('refuses a signer index outside the tree', async () => {
    const outside = rebuilt((info) => {
      info.signer = 99;
    });
    await expect(assertGroupInfoSignedBy(outside, signerKey)).rejects.toThrow(
      'not a leaf',
    );
  });

  it('refuses a snapshot without the ratchet_tree extension', async () => {
    const bare = rebuilt((info) => {
      info.extensions = [];
    });
    await expect(assertGroupInfoSignedBy(bare, signerKey)).rejects.toThrow(
      'no ratchet_tree',
    );
  });
});
