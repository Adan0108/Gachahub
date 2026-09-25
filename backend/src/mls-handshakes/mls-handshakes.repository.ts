import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import type { MlsHandshake, Prisma } from '../generated/prisma/client';
import { applyParticipantTransitions } from '../chat/membership/apply-participant-transitions';
import { MlsGroupRosterRepository } from '../mls-group-roster/mls-group-roster.repository';
import { PrismaService } from '../prisma/prisma.service';
import { MlsGroupInfoRepository } from './mls-group-info.repository';
import {
  assertAddedDevicesAuthorized,
  assertJoinerIsEntitled,
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

/** What a Commit changes and who sent it, for whichever way it reached the server. */
interface CommitToAccept {
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
  /** The snapshot of the group after this Commit, for devices that join by themselves. */
  groupInfo?: Uint8Array;
  /** A member changing the group, or a device outside it joining by itself. */
  sender: 'member' | 'external';
}

export type HandshakeAcceptResult =
  | { outcome: 'accepted'; handshake: HandshakeRow }
  | { outcome: 'duplicate'; handshake: HandshakeRow }
  | { outcome: 'conflict'; handshake: HandshakeRow };

@Injectable()
export class MlsHandshakesRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mlsGroupRosterRepository: MlsGroupRosterRepository,
    private readonly mlsGroupInfoRepository: MlsGroupInfoRepository,
  ) {}

  /** A Commit from a member of the group. */
  acceptHandshake(
    params: Omit<CommitToAccept, 'sender'>,
  ): Promise<HandshakeAcceptResult> {
    return this.acceptCommit({ ...params, sender: 'member' });
  }

  /** A device outside the group adding itself, by an external commit. No Welcome is involved. */
  acceptExternalJoin(params: {
    conversationId: string;
    expectedEpoch: number;
    deviceId: string;
    userId: string;
    payload: Uint8Array;
    payloadSha256: string;
    groupInfo?: Uint8Array;
  }): Promise<HandshakeAcceptResult> {
    const { deviceId, userId, ...rest } = params;

    return this.acceptCommit({
      ...rest,
      senderDeviceId: deviceId,
      senderUserId: userId,
      addedDeviceIds: [deviceId],
      removedDeviceIds: [],
      welcomes: [],
      sender: 'external',
    });
  }

  /** Atomic compare-and-set on mlsEpoch: one Commit wins an epoch and a loser gets the winning handshake back; epoch, roster and handshake rows change in one transaction. */
  private async acceptCommit(
    params: CommitToAccept,
  ): Promise<HandshakeAcceptResult> {
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

      if (params.groupInfo) {
        await this.mlsGroupInfoRepository.save(
          conversationId,
          expectedEpoch + 1,
          params.groupInfo,
          tx,
        );
      }

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
      // Only reachable if the conversation vanished mid-request.
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

  /** Applies the Commit's declared changes to the roster and participant rows after checking them against the authorized roster; the group-creating Commit makes the sender the founder. */
  private async applyMembershipChange(
    tx: Prisma.TransactionClient,
    params: {
      conversationId: string;
      expectedEpoch: number;
      senderDeviceId: string;
      senderUserId: string;
      addedDeviceIds: string[];
      removedDeviceIds: string[];
      sender: 'member' | 'external';
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
      sender,
    } = params;
    const newEpoch = expectedEpoch + 1;

    const groupJustActivated = !(await this.mlsGroupRosterRepository.hasRoster(
      conversationId,
      tx,
    ));

    if (groupJustActivated && sender === 'external') {
      throw new BadRequestException('There is no group to join yet');
    }

    if (groupJustActivated && expectedEpoch !== 0) {
      // Group predates membership tracking, so its members are unknown.
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

    if (sender === 'member' && !groupJustActivated) {
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

    const senderState = participantStateByUserId.get(senderUserId);
    if (sender === 'member') {
      assertSenderIsActiveParticipant(senderState);
    } else {
      assertJoinerIsEntitled(senderState);
    }

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

  /** The conversation's current epoch, or null if it doesn't exist. */
  async getCurrentEpoch(conversationId: string): Promise<number | null> {
    const conversation = await this.prisma.chatConversation.findUnique({
      where: { id: conversationId },
      select: { mlsEpoch: true },
    });

    return conversation?.mlsEpoch ?? null;
  }

  /** The leaves at `epoch` with each device's registered key; the key is null for a device whose record is gone. */
  async findRosterAtEpoch(conversationId: string, epoch: number) {
    const leaves = await this.mlsGroupRosterRepository.findLeavesAtEpoch(
      conversationId,
      epoch,
    );
    const devices = await this.prisma.chatDevice.findMany({
      where: { id: { in: leaves.map((leaf) => leaf.deviceId) } },
      select: { id: true, signaturePublicKey: true },
    });
    const keyByDeviceId = new Map(
      devices.map((device) => [device.id, device.signaturePublicKey]),
    );

    return leaves.map((leaf) => ({
      deviceId: leaf.deviceId,
      userId: leaf.userId,
      signaturePublicKey: keyByDeviceId.get(leaf.deviceId) ?? null,
    }));
  }

  findHandshakesSince(
    conversationId: string,
    fromEpoch: number,
    limit: number,
  ) {
    return this.prisma.mlsHandshake.findMany({
      where: { conversationId, epoch: { gte: fromEpoch } },
      orderBy: { epoch: 'asc' },
      take: limit,
    });
  }

  countPendingWelcomes(recipientDeviceId: string): Promise<number> {
    return this.prisma.mlsWelcome.count({
      where: { recipientDeviceId, consumedAt: null },
    });
  }

  /** Oldest first; `afterWelcomeId` resumes past that welcome. Null when that id is not one of this device's welcomes. */
  async findPendingWelcomes(
    recipientDeviceId: string,
    limit: number,
    afterWelcomeId?: string,
  ) {
    const cursor = afterWelcomeId
      ? await this.prisma.mlsWelcome.findFirst({
          where: { id: afterWelcomeId, recipientDeviceId },
          select: { createdAt: true, id: true },
        })
      : null;
    if (afterWelcomeId && !cursor) {
      return null;
    }

    return this.prisma.mlsWelcome.findMany({
      where: {
        recipientDeviceId,
        consumedAt: null,
        ...(cursor && {
          OR: [
            { createdAt: { gt: cursor.createdAt } },
            { createdAt: cursor.createdAt, id: { gt: cursor.id } },
          ],
        }),
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit,
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
