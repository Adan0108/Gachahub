import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MessageRequestSetting } from '../generated/prisma/client';
import { ChatRepository } from './chat.repository';
import { ChatAccessService } from './chat-access.service';
import { ChatMembershipService } from './membership/chat-membership.service';
import { CreateGroupChatDto } from './dto/create-group-chat.dto';
import { TransferGroupOwnershipDto } from './dto/transfer-group-ownership.dto';
import { UpdateGroupChatDto } from './dto/update-group-chat.dto';
import { UpdateGroupMembersDto } from './dto/update-group-members.dto';
import { UpdateGroupMemberRoleDto } from './dto/update-group-member-role.dto';

/**
 * Group chat lifecycle: create, update details, add/remove members,
 * transfer ownership, change roles, and leave. Pulled out of the former
 * monolithic ChatService as its own concern - group membership rules are
 * self-contained and don't share anything with direct-message send other
 * than the consent gate (assertMessageRequestAllowed, via ChatAccessService).
 */
@Injectable()
export class ChatGroupService {
  constructor(
    private readonly chatRepository: ChatRepository,
    private readonly chatAccessService: ChatAccessService,
    private readonly chatMembershipService: ChatMembershipService,
  ) {}

  /**
   * Creates a group chat with the caller as OWNER.
   *
   * Members who mutually follow the creator join ACTIVE immediately; everyone
   * else starts PENDING and must accept the invite first, same consent gate
   * as adding members to an existing group.
   */
  async createGroupChat(userId: string, dto: CreateGroupChatDto) {
    const memberIds = Array.from(new Set(dto.memberUserIds)).filter(
      (memberId) => memberId !== userId,
    );

    if (memberIds.length < 1) {
      throw new BadRequestException('Group chat requires at least one member');
    }

    const users = await this.chatRepository.findActiveUsersByIds(memberIds);

    if (users.length !== memberIds.length) {
      throw new BadRequestException('One or more group members are invalid');
    }

    const members = await this.resolveGroupMemberStates(userId, users);

    return this.chatRepository.createGroupConversation({
      creatorId: userId,
      title: dto.title,
      photoUrl: dto.photoUrl,
      members,
    });
  }

  /**
   * Updates a group chat's title and/or photo.
   *
   * Only OWNER and ADMIN participants can make this change.
   */
  async updateGroupChat(
    userId: string,
    conversationId: string,
    dto: UpdateGroupChatDto,
  ) {
    await this.chatAccessService.assertCanManageGroup(userId, conversationId);

    return this.chatRepository.updateGroupConversation({
      conversationId,
      title: dto.title,
      photoUrl: dto.photoUrl,
    });
  }

  /**
   * Adds members to a group chat.
   *
   * Only OWNER and ADMIN participants can add members. A member who mutually
   * follows the adder joins ACTIVE immediately; everyone else start PENDING
   * and must accept the invite via the existing request accept/decline flow.
   */
  async addGroupMembers(
    userId: string,
    conversationId: string,
    dto: UpdateGroupMembersDto,
  ) {
    await this.chatAccessService.assertCanManageGroup(userId, conversationId);

    const memberIds = Array.from(new Set(dto.userIds)).filter(
      (memberId) => memberId !== userId,
    );

    if (memberIds.length < 1) {
      throw new BadRequestException('At least one member is required');
    }

    const users = await this.chatRepository.findActiveUsersByIds(memberIds);

    if (users.length !== memberIds.length) {
      throw new BadRequestException('One or more group members are invalid');
    }

    const members = await this.resolveGroupMemberStates(userId, users);

    return this.chatMembershipService.addMembers(
      conversationId,
      members.map((member) => ({
        userId: member.userId,
        entitlement: member.state === 'ACTIVE' ? 'DIRECT' : 'INVITE',
      })),
    );
  }

  /**
   * Removes members from a group chat.
   *
   * Removed members lose access at once and end up DECLINED so message history can
   * remain intact; in an MLS-encrypted group that final step waits for a member's
   * Remove Commit (see ChatMembershipService).
   */
  async removeGroupMembers(
    userId: string,
    conversationId: string,
    dto: UpdateGroupMembersDto,
  ) {
    await this.chatAccessService.assertCanManageGroup(userId, conversationId);

    if (dto.userIds.includes(userId)) {
      throw new BadRequestException('Use leave group instead');
    }

    return this.chatMembershipService.removeMembers(
      conversationId,
      Array.from(new Set(dto.userIds)),
    );
  }

  /**
   * Transfer group ownership to another active member.
   *
   * The current owner becomes an ADMIN instead of losing group access,
   * and can leave normally afterward.
   */
  async transferGroupOwnership(
    userId: string,
    conversationId: string,
    dto: TransferGroupOwnershipDto,
  ) {
    await this.chatAccessService.assertIsGroupOwner(userId, conversationId);

    if (dto.newOwnerUserId === userId) {
      throw new BadRequestException('You already own this group');
    }

    const newOwner = await this.chatRepository.findParticipant(
      conversationId,
      dto.newOwnerUserId,
    );

    if (!newOwner || newOwner.state !== 'ACTIVE') {
      throw new BadRequestException('New owner must be an active group member');
    }

    return this.chatRepository.transferGroupOwnership(
      conversationId,
      userId,
      dto.newOwnerUserId,
    );
  }

  /**
   * Promote or demotes a group member between MEMBER and ADMIN.
   *
   * Only the owner can change roles. Use transferGroupOwnership to
   * change who owns the group instead.
   */
  async updateGroupMemberRole(
    userId: string,
    conversationId: string,
    targetUserId: string,
    dto: UpdateGroupMemberRoleDto,
  ) {
    await this.chatAccessService.assertIsGroupOwner(userId, conversationId);

    if (targetUserId === userId) {
      throw new BadRequestException(
        'Use transferGroupOwnership to change your own role',
      );
    }

    const target = await this.chatRepository.findParticipant(
      conversationId,
      targetUserId,
    );

    if (!target || target.state !== 'ACTIVE') {
      throw new NotFoundException('Group member not found');
    }

    if (target.role === 'OWNER') {
      throw new BadRequestException('Cannot change role of group owner');
    }

    return this.chatRepository.updateParticipantRole(
      conversationId,
      targetUserId,
      dto.role,
    );
  }

  /**
   * Lets a group member leave.
   *
   * Owners must transfer ownership before leaving, unless they're the last
   * active member left — then leaving just closes the group with them.
   */
  async leaveGroup(userId: string, conversationId: string) {
    const conversation =
      await this.chatRepository.findConversationWithParticipants(
        conversationId,
      );

    if (!conversation || conversation.type !== 'GROUP') {
      throw new NotFoundException('Group conversation not found');
    }

    const participant = conversation.participants.find(
      (item) => item.userId === userId,
    );

    if (!participant || participant.state !== 'ACTIVE') {
      throw new ForbiddenException('You are not in this group');
    }

    if (participant.role === 'OWNER') {
      const hasOtherActiveMembers = conversation.participants.some(
        (item) => item.userId !== userId && item.state === 'ACTIVE',
      );

      if (hasOtherActiveMembers) {
        throw new BadRequestException(
          'Owner cannot leave before transferring ownership',
        );
      }

      // sole remaining member, nobody left to transfer to, group closes with them - and
      // retires their device leaves too, not just their participant row (see
      // ChatRepository.closeSoleOwnerGroup)
      return this.chatRepository.closeSoleOwnerGroup(
        conversationId,
        userId,
        conversation.mlsEpoch,
      );
    }

    return this.chatMembershipService.removeMembers(conversationId, [userId]);
  }

  /**
   * Resolves each candidate group member to ACTIVE or PENDING.
   *
   * Shared by createGroupChat and addGroupMembers — applies the same
   * message-request gate as createDirectMessage, per member.
   */
  private async resolveGroupMemberStates(
    userId: string,
    members: Array<{
      id: string;
      messageRequestSetting: MessageRequestSetting;
    }>,
  ) {
    return Promise.all(
      members.map(async (member) => {
        const areMutualFollowers =
          await this.chatAccessService.assertMessageRequestAllowed(
            userId,
            member,
          );

        return {
          userId: member.id,
          state: areMutualFollowers
            ? ('ACTIVE' as const)
            : ('PENDING' as const),
        };
      }),
    );
  }
}
