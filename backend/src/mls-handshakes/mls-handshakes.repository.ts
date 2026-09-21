import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import type { MlsHandshake, Prisma } from '../generated/prisma/client';
import { applyParticipantTransitions } from '../chat/membership/apply-participant-transitions';
import { MlsGroupRosterRepository } from '../mls-group-roster/mls-group-roster.repository';
import { PrismaService } from '../prisma/prisma.service';
import {
  assertAddedDevicesAuthorized,
  assertRemovedDevicesRemovable,
  assertSenderIsActiveParticipant,
  assertSenderIsMember,
  attestMembershipChange,
  planCommitTransitions,
  type AttestedAddedDevice,
  type AttestedRemovedDevice,
  type DeviceFact,
} from './mls-membership-rules';

/** senderDeviceId is null once the sending device (and its account) has been deleted - the Commit is kept regardless. */
type HandshakeRow = MlsHandshake;

export type HandshakeAcceptResult =
  | { outcome: 'accepted'; handshake: HandshakeRow }
  | { outcome: 'duplicate'; handshake: HandshakeRow }
  | { outcome: 'conflict'; handshake: HandshakeRow };

@Injectable()
export class MlsHandshakesRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mlsGroupRosterRepository: MlsGroupRosterRepository,
  ) {}

  /**
   * ChatModule exports nothing today, and importing it here would risk a
   * circular dependency once stage 5 has it call into MlsHandshakesService -
   * so this duplicates a trivial lookup instead, matching existing
   * precedent (chat-devices.repository.ts already queries `user` directly
   * for the same reason).
   */
  async isActiveParticipant(
    conversationId: string,
    userId: string,
  ): Promise<boolean> {
    const participant = await this.prisma.chatParticipant.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
    });

    return participant?.state === 'ACTIVE';
  }

  /**
   * Atomic compare-and-set: mlsEpoch only advances when expectedEpoch still
   * matches, so exactly one Commit ever wins a given epoch. A loser gets
   * back whatever handshake DID win, so it can tell a harmless retry (same
   * payload) from a real conflict (someone else's Commit) it must catch up
   * on - the server never resolves crypto conflicts itself, only ordering.
   *
   * The epoch bump, the roster and participant changes the Commit makes (see
   * applyMembershipChange), and the handshake/welcome rows all happen in one
   * transaction (threat-model §3: "the two must be kept in sync in the same
   * transaction"). If any rule is broken the whole Commit is rejected and
   * rolled back, including the epoch bump, rather than leaving an epoch
   * advanced with no matching handshake row or the two rosters out of step.
   */
  async acceptHandshake(params: {
    conversationId: string;
    expectedEpoch: number;
    senderDeviceId: string;
    senderUserId: string;
    payload: Uint8Array;
    payloadSha256: string;
    /** Devices this Commit adds, as declared by the sender. Each needs a Welcome. */
    addedDeviceIds: string[];
    /** Devices this Commit removes, as declared by the sender. */
    removedDeviceIds: string[];
    welcomes: { recipientDeviceId: string; payload: Uint8Array }[];
  }): Promise<HandshakeAcceptResult> {
    const {
      conversationId,
      expectedEpoch,
      senderDeviceId,
      payload,
      payloadSha256,
      welcomes,
    } = params;

    const accepted = await this.prisma.$transaction(async (tx) => {
      const advanced = await tx.chatConversation.updateMany({
        where: { id: conversationId, mlsEpoch: expectedEpoch },
        // The Commit is the work the lease was for, so the next round starts clean.
        data: {
          mlsEpoch: { increment: 1 },
          mlsWorkLeaseDeviceId: null,
          mlsWorkLeaseUntil: null,
        },
      });

      if (advanced.count === 0) {
        return null;
      }

      const attested = await this.applyMembershipChange(tx, params);

      const handshake = await tx.mlsHandshake.create({
        data: {
          conversationId,
          epoch: expectedEpoch,
          senderDeviceId,
          payload: payload.slice(),
          payloadSha256,
          membershipDeclared: true,
          addedDevices: attested.addedDevices,
          removedDevices: attested.removedDevices,
        },
      });

      if (welcomes.length > 0) {
        await tx.mlsWelcome.createMany({
          data: welcomes.map((welcome) => ({
            conversationId,
            recipientDeviceId: welcome.recipientDeviceId,
            payload: welcome.payload.slice(),
          })),
        });
      }

      return handshake;
    });

    if (accepted) {
      return { outcome: 'accepted', handshake: accepted };
    }

    const winner = await this.prisma.mlsHandshake.findUnique({
      where: { conversationId_epoch: { conversationId, epoch: expectedEpoch } },
    });

    if (!winner) {
      // Only reachable if conversationId itself vanished mid-request -
      // callers check participation (and therefore existence) beforehand.
      throw new Error(
        `No handshake found for conversation ${conversationId} at epoch ${expectedEpoch}`,
      );
    }

    return {
      outcome:
        winner.payloadSha256 === payloadSha256 ? 'duplicate' : 'conflict',
      handshake: winner,
    };
  }

  /**
   * Brings the roster and the participant rows in line with the Commit being
   * accepted, after checking its declared changes against the authorized
   * roster (mls-membership-rules.ts). MLS Add is only ever the cryptographic
   * side effect of a decision the server already made - a Commit can never be
   * the thing that first grants conversation membership.
   *
   * The Commit that creates the group is special: the roster is empty, the
   * sender's device is the founder, and anyone already ACTIVE without a device
   * in the new group is moved to JOINING.
   */
  private async applyMembershipChange(
    tx: Prisma.TransactionClient,
    params: {
      conversationId: string;
      expectedEpoch: number;
      senderDeviceId: string;
      senderUserId: string;
      addedDeviceIds: string[];
      removedDeviceIds: string[];
    },
  ): Promise<{
    addedDevices: AttestedAddedDevice[];
    removedDevices: AttestedRemovedDevice[];
  }> {
    const {
      conversationId,
      expectedEpoch,
      senderDeviceId,
      senderUserId,
      addedDeviceIds,
      removedDeviceIds,
    } = params;
    const newEpoch = expectedEpoch + 1;

    const groupJustActivated = !(await this.mlsGroupRosterRepository.hasRoster(
      conversationId,
      tx,
    ));

    if (groupJustActivated && expectedEpoch !== 0) {
      // The group already ran before membership was tracked, so who is in it
      // is unknown - guessing would let the two rosters silently disagree.
      throw new BadRequestException(
        'This conversation predates membership tracking and cannot be extended',
      );
    }

    const activeLeaves = groupJustActivated
      ? []
      : await this.mlsGroupRosterRepository.findActiveLeaves(
          conversationId,
          tx,
        );
    const activeLeafDeviceIds = new Set(
      activeLeaves.map((leaf) => leaf.deviceId),
    );

    if (!groupJustActivated) {
      assertSenderIsMember(activeLeafDeviceIds, senderDeviceId);
    }

    const devices = await tx.chatDevice.findMany({
      where: { id: { in: [...addedDeviceIds, ...removedDeviceIds] } },
      select: {
        id: true,
        userId: true,
        revokedAt: true,
        signaturePublicKey: true,
      },
    });
    const participants = await tx.chatParticipant.findMany({
      where: { conversationId },
      select: { userId: true, state: true },
    });
    const deviceById = new Map<string, DeviceFact>(
      devices.map((device) => [device.id, device]),
    );
    const participantStateByUserId = new Map(
      participants.map((participant) => [
        participant.userId,
        participant.state,
      ]),
    );

    const activeLeafUserIdByDeviceId = new Map(
      activeLeaves.map((leaf) => [leaf.deviceId, leaf.userId]),
    );

    assertSenderIsActiveParticipant(participantStateByUserId.get(senderUserId));

    assertAddedDevicesAuthorized({
      addedDeviceIds,
      deviceById,
      participantStateByUserId,
      activeLeafDeviceIds,
    });
    assertRemovedDevicesRemovable({
      removedDeviceIds,
      activeLeafUserIdByDeviceId,
      deviceById,
      participantStateByUserId,
    });

    const attested = attestMembershipChange({
      addedDeviceIds,
      removedDeviceIds,
      deviceById,
      activeLeafUserIdByDeviceId,
    });

    const removedCount = await this.mlsGroupRosterRepository.removeLeaves(
      conversationId,
      removedDeviceIds,
      newEpoch,
      tx,
    );
    if (removedCount !== removedDeviceIds.length) {
      throw new ConflictException(
        'The group changed while this Commit was being accepted - please retry',
      );
    }

    const addedLeaves = addedDeviceIds.map((deviceId) => ({
      deviceId,
      userId: deviceById.get(deviceId)!.userId,
    }));

    if (groupJustActivated) {
      await this.mlsGroupRosterRepository.addLeaves(
        conversationId,
        [{ deviceId: senderDeviceId, userId: senderUserId }],
        0,
        tx,
      );
    }
    await this.mlsGroupRosterRepository.addLeaves(
      conversationId,
      addedLeaves,
      newEpoch,
      tx,
    );

    const removedDeviceIdSet = new Set(removedDeviceIds);
    const userIdsWithDevices = new Set([
      ...activeLeaves
        .filter((leaf) => !removedDeviceIdSet.has(leaf.deviceId))
        .map((leaf) => leaf.userId),
      ...addedLeaves.map((leaf) => leaf.userId),
      ...(groupJustActivated ? [senderUserId] : []),
    ]);

    const removedUserIds = activeLeaves
      .filter((leaf) => removedDeviceIdSet.has(leaf.deviceId))
      .map((leaf) => leaf.userId);

    const transitions = planCommitTransitions({
      participantStateByUserId,
      addedUserIds: addedLeaves.map((leaf) => leaf.userId),
      fullyRemovedUserIds: removedUserIds.filter(
        (userId) => !userIdsWithDevices.has(userId),
      ),
      userIdsWithDevices,
      groupJustActivated,
    });

    await applyParticipantTransitions(tx, conversationId, transitions);

    return attested;
  }

  findHandshakeByEpoch(conversationId: string, epoch: number) {
    return this.prisma.mlsHandshake.findUnique({
      where: { conversationId_epoch: { conversationId, epoch } },
      select: { senderDeviceId: true },
    });
  }

  /** Returns false when this reporter had already filed this fault. */
  async recordCommitFault(fault: {
    conversationId: string;
    epoch: number;
    senderDeviceId: string | null;
    reporterDeviceId: string;
    reason: string;
  }): Promise<boolean> {
    const result = await this.prisma.mlsCommitFault.createMany({
      data: [fault],
      skipDuplicates: true,
    });

    return result.count === 1;
  }

  findHandshakesSince(conversationId: string, fromEpoch: number) {
    return this.prisma.mlsHandshake.findMany({
      where: { conversationId, epoch: { gte: fromEpoch } },
      orderBy: { epoch: 'asc' },
    });
  }

  findPendingWelcomes(recipientDeviceId: string) {
    return this.prisma.mlsWelcome.findMany({
      where: { recipientDeviceId, consumedAt: null },
      orderBy: { createdAt: 'asc' },
    });
  }

  async markWelcomeConsumed(
    welcomeId: string,
    recipientDeviceId: string,
  ): Promise<boolean> {
    const result = await this.prisma.mlsWelcome.updateMany({
      where: { id: welcomeId, recipientDeviceId, consumedAt: null },
      data: { consumedAt: new Date() },
    });

    return result.count === 1;
  }
}
