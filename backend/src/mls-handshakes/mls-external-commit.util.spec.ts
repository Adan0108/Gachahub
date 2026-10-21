import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { decodeMlsMessage, encodeMlsMessage } from 'ts-mls';
import {
  assertJoinerMatchesDevice,
  assertRemovedLeafIsJoiner,
  readExternalJoin,
} from './mls-external-commit.util';
import { assertIsGroupInfoFor } from './mls-group-info.util';
import { buildTestCommitWithWelcome } from './test-support/build-test-commit';
import {
  buildTestExternalJoin,
  buildTestExternalResync,
  type TestExternalJoin,
  type TestExternalResync,
} from './test-support/build-test-external-join';

const joiner = { userId: 'user-1', deviceId: 'device-1' };

describe('external join framing', () => {
  let join: TestExternalJoin;

  beforeAll(async () => {
    join = await buildTestExternalJoin('conv-1', joiner);
  });

  describe('readExternalJoin', () => {
    it('reads who a real external commit adds, from the joiner leaf', () => {
      expect(
        readExternalJoin(join.commitPayload, 'conv-1', join.epoch),
      ).toEqual({
        ...joiner,
        signatureKey: join.joinerSignatureKey,
      });
    });

    it('refuses one for another conversation or another epoch', () => {
      expect(() =>
        readExternalJoin(join.commitPayload, 'conv-other', join.epoch),
      ).toThrow(BadRequestException);
      expect(() =>
        readExternalJoin(join.commitPayload, 'conv-1', join.epoch + 1),
      ).toThrow(BadRequestException);
    });

    it('refuses a private commit, which is not a join', async () => {
      const { commitPayload, epoch } =
        await buildTestCommitWithWelcome('conv-1');

      expect(() => readExternalJoin(commitPayload, 'conv-1', epoch)).toThrow(
        BadRequestException,
      );
    });

    it('refuses anything that is not an MLS message', () => {
      expect(() =>
        readExternalJoin(new Uint8Array([1, 2, 3]), 'conv-1', 0),
      ).toThrow(BadRequestException);
    });

    it('reports no removed leaf for a plain join', () => {
      expect(
        readExternalJoin(join.commitPayload, 'conv-1', join.epoch)
          .removedLeafIndex,
      ).toBeUndefined();
    });

    const withProposals = (
      payload: Uint8Array,
      change: (proposals: unknown[]) => void,
    ) => {
      const decoded = decodeMlsMessage(payload, 0)![0];
      if (decoded.wireformat !== 'mls_public_message') throw new Error('x');
      const { content } = decoded.publicMessage;
      if (content.contentType !== 'commit') throw new Error('x');
      change(content.commit.proposals);
      return encodeMlsMessage(decoded);
    };
    const remove = (index: number) => ({
      proposalOrRefType: 'proposal',
      proposal: { proposalType: 'remove', remove: { removed: index } },
    });

    it('refuses a join that carries any other proposal, so a joiner can only add or replace itself', () => {
      const withAReference = withProposals(join.commitPayload, (proposals) =>
        proposals.push({
          proposalOrRefType: 'reference',
          reference: new Uint8Array(32),
        }),
      );

      expect(() =>
        readExternalJoin(withAReference, 'conv-1', join.epoch),
      ).toThrow(/ExternalInit/);
    });

    it('refuses a join that removes more than one leaf', () => {
      const removesTwo = withProposals(join.commitPayload, (proposals) =>
        proposals.push(remove(0), remove(1)),
      );

      expect(() => readExternalJoin(removesTwo, 'conv-1', join.epoch)).toThrow(
        /ExternalInit/,
      );
    });

    it('refuses a Remove with no ExternalInit', () => {
      const onlyARemove = withProposals(join.commitPayload, (proposals) => {
        proposals.splice(0, proposals.length, remove(0));
      });

      expect(() => readExternalJoin(onlyARemove, 'conv-1', join.epoch)).toThrow(
        /ExternalInit/,
      );
    });

    describe('a device replacing its own old leaf (resync)', () => {
      let resync: TestExternalResync;

      beforeAll(async () => {
        resync = await buildTestExternalResync('conv-1', joiner);
      });

      it('reads the joiner and which leaf it removes', () => {
        expect(
          readExternalJoin(resync.commitPayload, 'conv-1', resync.epoch),
        ).toEqual({
          ...joiner,
          signatureKey: resync.joinerSignatureKey,
          removedLeafIndex: resync.removedLeafIndex,
        });
      });

      it('accepts the removed leaf when it is the joiner own, from the stored snapshot', () => {
        expect(() =>
          assertRemovedLeafIsJoiner(
            resync.removedLeafIndex,
            resync.groupInfoPayload,
            { ...joiner, signaturePublicKey: resync.joinerSignatureKey },
          ),
        ).not.toThrow();
      });

      it('refuses a Remove aimed at someone else leaf', () => {
        expect(() =>
          assertRemovedLeafIsJoiner(0, join.groupInfoPayload, {
            ...joiner,
            signaturePublicKey: join.joinerSignatureKey,
          }),
        ).toThrow(ForbiddenException);
      });

      it('refuses a Remove of a leaf with the right name but another key', () => {
        expect(() =>
          assertRemovedLeafIsJoiner(
            resync.removedLeafIndex,
            resync.groupInfoPayload,
            { ...joiner, signaturePublicKey: new Uint8Array([9, 9]) },
          ),
        ).toThrow(ForbiddenException);
      });

      it('refuses a leaf that is not in the snapshot at all', () => {
        expect(() =>
          assertRemovedLeafIsJoiner(7, resync.groupInfoPayload, {
            ...joiner,
            signaturePublicKey: resync.joinerSignatureKey,
          }),
        ).toThrow(BadRequestException);
      });
    });
  });

  describe('assertJoinerMatchesDevice', () => {
    const device = {
      ...joiner,
      signaturePublicKey: new Uint8Array([1, 2, 3]),
    };
    const asJoiner = (overrides: Partial<typeof joiner> = {}) => ({
      ...joiner,
      ...overrides,
      signatureKey: new Uint8Array([1, 2, 3]),
    });

    it('accepts the calling user device with its registered key', () => {
      expect(() => assertJoinerMatchesDevice(asJoiner(), device)).not.toThrow();
    });

    it('refuses another user, another device, or another key', () => {
      expect(() =>
        assertJoinerMatchesDevice(asJoiner({ userId: 'someone-else' }), device),
      ).toThrow(ForbiddenException);
      expect(() =>
        assertJoinerMatchesDevice(asJoiner({ deviceId: 'other' }), device),
      ).toThrow(ForbiddenException);
      expect(() =>
        assertJoinerMatchesDevice(
          { ...asJoiner(), signatureKey: new Uint8Array([9]) },
          device,
        ),
      ).toThrow(ForbiddenException);
    });
  });

  describe('assertIsGroupInfoFor', () => {
    it('accepts a real GroupInfo for the conversation and epoch it describes', () => {
      expect(() =>
        assertIsGroupInfoFor(join.groupInfoPayload, 'conv-1', join.epoch),
      ).not.toThrow();
      expect(() =>
        assertIsGroupInfoFor(
          join.nextGroupInfoPayload,
          'conv-1',
          join.epoch + 1,
        ),
      ).not.toThrow();
    });

    it('refuses another conversation, another epoch, or something that is not a GroupInfo', () => {
      expect(() =>
        assertIsGroupInfoFor(join.groupInfoPayload, 'conv-other', join.epoch),
      ).toThrow(BadRequestException);
      expect(() =>
        assertIsGroupInfoFor(join.groupInfoPayload, 'conv-1', join.epoch + 1),
      ).toThrow(BadRequestException);
      expect(() =>
        assertIsGroupInfoFor(join.commitPayload, 'conv-1', join.epoch),
      ).toThrow(BadRequestException);
      expect(() =>
        assertIsGroupInfoFor(new Uint8Array([1]), 'conv-1', 0),
      ).toThrow(BadRequestException);
    });
  });
});
