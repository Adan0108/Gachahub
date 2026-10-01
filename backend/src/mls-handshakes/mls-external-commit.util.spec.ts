import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { decodeMlsMessage, encodeMlsMessage } from 'ts-mls';
import {
  assertJoinerMatchesDevice,
  readExternalJoin,
} from './mls-external-commit.util';
import { assertIsGroupInfoFor } from './mls-group-info.util';
import { buildTestCommitWithWelcome } from './test-support/build-test-commit';
import {
  buildTestExternalJoin,
  type TestExternalJoin,
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

    it('refuses a join that carries another proposal, such as a Remove, so a joiner can only add itself', () => {
      const decoded = decodeMlsMessage(join.commitPayload, 0)![0];
      if (decoded.wireformat !== 'mls_public_message') throw new Error('x');
      const { content } = decoded.publicMessage;
      if (content.contentType !== 'commit') throw new Error('x');
      content.commit.proposals.push({
        proposalOrRefType: 'proposal',
        proposal: { proposalType: 'remove', remove: { removed: 0 } },
      });
      const tampered = encodeMlsMessage(decoded);

      expect(() => readExternalJoin(tampered, 'conv-1', join.epoch)).toThrow(
        /exactly one ExternalInit/,
      );
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
