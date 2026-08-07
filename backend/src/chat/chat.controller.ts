import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Session } from '@thallesp/nestjs-better-auth';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { GameModeratorGuard } from '../common/guards/game-moderator.guard';
import { ChatService } from './chat.service';
import { CreateChatEmoteDto } from './dto/create-chat-emote.dto';
import { CreateDirectMessageDto } from './dto/create-direct-message.dto';
import { CreateGroupChatDto } from './dto/create-group-chat.dto';
import { EditMessageDto } from './dto/edit-message.dto';
import { MarkConversationReadDto } from './dto/mark-conversation-read.dto';
import { MarkMessagesDeliveredDto } from './dto/mark-messages-delivered.dto';
import { QueryChatMessagesDto } from './dto/query-chat-messages.dto';
import { ReactToMessageDto } from './dto/react-to-message.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { TransferGroupOwnershipDto } from './dto/transfer-group-ownership.dto';
import { UpdateGroupChatDto } from './dto/update-group-chat.dto';
import { UpdateGroupMembersDto } from './dto/update-group-members.dto';
import { UpdateGroupMemberRoleDto } from './dto/update-group-member-role.dto';

@ApiTags('Chat')
@ApiCookieAuth('better-auth.session_token')
@Controller('chat')
/**
 * Controller responsible for chat HTTP routes.
 *
 * Responsibilities:
 * - Read route params, query params, request bodies, and current session user
 * - Call ChatService
 * - Keep chat business rules out of the HTTP layer
 */
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  /**
   * Creates or reuses a direct convo and sends the first message.
   *
   * This endpoint accepts encrypted client payloads only. The backend stores
   * ciphertext and metadata, but never receives plaintext message content.
   */
  @Post('direct')
  @ApiOperation({
    summary: 'Create or reuse a direct conversation and send a message',
    description:
      'Stores client-side encrypted ciphertext only. Stranger recipients receive a pending request, not a notification.',
  })
  createDirectMessage(
    @Session() session: UserSession,
    @Body() dto: CreateDirectMessageDto,
  ) {
    return this.chatService.createDirectMessage(session.user.id, dto);
  }

  /**
   * Lists accepted conversations for the current user.
   *
   * Pending stranger messages are intentionally excluded from this inbox and
   * exposed through GET /chat/requests instead.
   */
  @Get('conversations')
  @ApiOperation({
    summary: 'List accepted chat conversations for the current user',
  })
  listConversations(@Session() session: UserSession) {
    return this.chatService.listConversations(session.user.id);
  }

  /**
   * Lists pending stranger message requests
   *
   * Users can preview pending encrypted messages here before accepting the
   * conversation into their main inbox.
   */
  @Get('requests')
  @ApiOperation({
    summary: 'List pending stranger message requests for the current user',
  })
  listMessageRequests(@Session() session: UserSession) {
    return this.chatService.listMessageRequests(session.user.id);
  }

  /**
   * Lists archived conversations for the current user.
   *
   * Archived conversations are hidden from the normal inbox,
   * this is where become visible again.
   */
  @Get('conversations/archived')
  @ApiOperation({
    summary: 'List archived conversations for the current user',
  })
  listArchivedConversations(@Session() session: UserSession) {
    return this.chatService.listArchivedConversations(session.user.id);
  }

  /**
   * Lists encrypted messages in a convo.
   *
   * Pagination is cursor-based using beforeMessageId so clients can load older
   * messages without requesting the entire convo history.
   */
  @Get('conversations/:conversationId/messages')
  @ApiOperation({
    summary: 'List encrypted messages in a conversation',
  })
  @ApiParam({
    name: 'conversationId',
    example: 'cm123conversation456',
  })
  findMessages(
    @Session() session: UserSession,
    @Param('conversationId') conversationId: string,
    @Query() query: QueryChatMessagesDto,
  ) {
    return this.chatService.findMessages(
      session.user.id,
      conversationId,
      query,
    );
  }

  /**
   * Returns unread chat counts for the current user.
   *
   * Used by frontend badges without loading the full conversation list.
   */
  @Get('unread-summary')
  @ApiOperation({
    summary: 'Get current user chat unread summary',
  })
  getUnreadSummary(@Session() session: UserSession) {
    return this.chatService.getUnreadSummary(session.user.id);
  }

  /**
   * Creates a group conversation with the caller as owner.
   *
   * Group messages still use encrypted payloads later through the normal send
   * message endpoint.
   */
  @Post('groups')
  @ApiOperation({
    summary: 'Create a group chat',
  })
  createGroupChat(
    @Session() session: UserSession,
    @Body() dto: CreateGroupChatDto,
  ) {
    return this.chatService.createGroupChat(session.user.id, dto);
  }

  /**
   * Updates group title/photo.
   *
   * Only group OWNER and ADMIN participants can update group details.
   */
  @Patch('groups/:conversationId')
  @ApiOperation({
    summary: 'Update group chat details',
  })
  @ApiParam({
    name: 'conversationId',
    example: 'cm123conversation456',
  })
  updateGroupChat(
    @Session() session: UserSession,
    @Param('conversationId') conversationId: string,
    @Body() dto: UpdateGroupChatDto,
  ) {
    return this.chatService.updateGroupChat(
      session.user.id,
      conversationId,
      dto,
    );
  }

  /**
   * Adds users to an existing group chat.
   *
   * Only group OWNER and ADMIN participants can add members.
   */
  @Post('groups/:conversationId/members')
  @ApiOperation({
    summary: 'Add group chat members',
  })
  @ApiParam({
    name: 'conversationId',
    example: 'cm123conversation456',
  })
  addGroupMembers(
    @Session() session: UserSession,
    @Param('conversationId') conversationId: string,
    @Body() dto: UpdateGroupMembersDto,
  ) {
    return this.chatService.addGroupMembers(
      session.user.id,
      conversationId,
      dto,
    );
  }

  /**
   * Removes users from an existing group chat.
   *
   * Owner cannot be removed through this endpoint.
   */
  @Delete('groups/:conversationId/members')
  @ApiOperation({
    summary: 'Remove group chat members',
  })
  @ApiParam({
    name: 'conversationId',
    example: 'cm123conversation456',
  })
  removeGroupMembers(
    @Session() session: UserSession,
    @Param('conversationId') conversationId: string,
    @Body() dto: UpdateGroupMembersDto,
  ) {
    return this.chatService.removeGroupMembers(
      session.user.id,
      conversationId,
      dto,
    );
  }

  /**
   * Transfser group ownership to another active member.
   *
   * Owner-only. Previous owner becomes ADMIN instead losing access.
   */
  @Post('groups/:conversationId/transfer-ownership')
  @ApiOperation({
    summary: 'Transfer group ownership to another member',
  })
  @ApiParam({
    name: 'conversationId',
    example: 'cm123conversation456',
  })
  transferGroupOwnership(
    @Session() session: UserSession,
    @Param('conversationId') conversationId: string,
    @Body() dto: TransferGroupOwnershipDto,
  ) {
    return this.chatService.transferGroupOwnership(
      session.user.id,
      conversationId,
      dto,
    );
  }

  /**
   * Promote or demotes a group member's role.
   *
   * Owner only, cannot be used to change owner's own role.
   */
  @Patch('groups/:conversationId/members/:userId/role')
  @ApiOperation({
    summary: 'Promote or demote a group member',
  })
  @ApiParam({
    name: 'conversationId',
    example: 'cm123conversation456',
  })
  @ApiParam({
    name: 'userId',
    example: 'target-user-id',
  })
  updateGroupMemberRole(
    @Session() session: UserSession,
    @Param('conversationId') conversationId: string,
    @Param('userId') userId: string,
    @Body() dto: UpdateGroupMemberRoleDto,
  ) {
    return this.chatService.updateGroupMemberRole(
      session.user.id,
      conversationId,
      userId,
      dto,
    );
  }

  /**
   * Leaves a group chat as the current user.
   *
   * Owners must transfer ownership before leaving.
   */
  @Post('groups/:conversationId/leave')
  @ApiOperation({
    summary: 'Leave a group chat',
  })
  @ApiParam({
    name: 'conversationId',
    example: 'cm123conversation456',
  })
  leaveGroup(
    @Session() session: UserSession,
    @Param('conversationId') conversationId: string,
  ) {
    return this.chatService.leaveGroup(session.user.id, conversationId);
  }

  /**
   * Sends an encrypted message in an existing conversation
   *
   * Service logic validates that the sender is an active participant and that
   * the target conversation can still accept messages from the sender.
   */
  @Post('conversations/:conversationId/messages')
  @ApiOperation({
    summary: 'Send an encrypted message in an existing conversation',
  })
  @ApiParam({
    name: 'conversationId',
    example: 'cm123conversation456',
  })
  sendMessage(
    @Session() session: UserSession,
    @Param('conversationId') conversationId: string,
    @Body() dto: SendMessageDto,
  ) {
    return this.chatService.sendMessage(session.user.id, conversationId, dto);
  }

  /**
   * Accepts a pending stranger conversation.
   *
   * After this, future messages in the conversation can behave like normal
   * inbox messages and and can get notification.
   */
  @Post('requests/:conversationId/accept')
  @ApiOperation({
    summary: 'Accept a pending stranger message request',
  })
  @ApiParam({
    name: 'conversationId',
    example: 'cm123conversation456',
  })
  acceptRequest(
    @Session() session: UserSession,
    @Param('conversationId') conversationId: string,
  ) {
    return this.chatService.acceptRequest(session.user.id, conversationId);
  }

  /**
   * Declines a pending stranger conversation.
   *
   * Declined conversations reject future sends from the other participant.
   */
  @Post('requests/:conversationId/decline')
  @ApiOperation({
    summary: 'Decline a pending stranger message request',
  })
  @ApiParam({
    name: 'conversationId',
    example: 'cm123conversation456',
  })
  declineRequest(
    @Session() session: UserSession,
    @Param('conversationId') conversationId: string,
  ) {
    return this.chatService.declineRequest(session.user.id, conversationId);
  }

  /**
   * Blocks a conversation for current user.
   *
   * This stores participant-level state so future user safety behavior can be
   * expanded without changing the message schema.
   */
  @Post('conversations/:conversationId/block')
  @ApiOperation({
    summary: 'Block a chat conversation for the current user',
  })
  @ApiParam({
    name: 'conversationId',
    example: 'cm123conversation456',
  })
  blockConversation(
    @Session() session: UserSession,
    @Param('conversationId') conversationId: string,
  ) {
    return this.chatService.blockConversation(session.user.id, conversationId);
  }

  /**
   * Blocks another user globally for chat.
   *
   * The blocked user cannot start or continue direct chat with the caller.
   */
  @Post('users/:userId/block')
  @ApiOperation({
    summary: 'Block a user globally for chat',
  })
  @ApiParam({
    name: 'userId',
    example: 'target-user-id',
  })
  blockUser(@Session() session: UserSession, @Param('userId') userId: string) {
    return this.chatService.blockUser(session.user.id, userId);
  }

  /**
   * Unblocks another user globally for chat.
   *
   * After this, normal direct chat rules apply again.
   */
  @Delete('users/:userId/block')
  @ApiOperation({
    summary: 'Unblock a user globally for chat',
  })
  @ApiParam({
    name: 'userId',
    example: 'target-user-id',
  })
  unblockUser(
    @Session() session: UserSession,
    @Param('userId') userId: string,
  ) {
    return this.chatService.unblockUser(session.user.id, userId);
  }

  /**
   * Mutes a conversation for the current user.
   *
   * Muted chats still receive messages, but notification delivery can skip
   * this user later by checking participant mutedAt.
   */
  @Post('conversations/:conversationId/mute')
  @ApiOperation({
    summary: 'Mute a conversation for the current user',
  })
  @ApiParam({
    name: 'conversationId',
    example: 'cm123conversation456',
  })
  muteConversation(
    @Session() session: UserSession,
    @Param('conversationId') conversationId: string,
  ) {
    return this.chatService.muteConversation(session.user.id, conversationId);
  }

  /**
   * Unmutes a conversation for the current user.
   *
   * This clears mutedAt on the caller's participant row.
   */
  @Delete('conversations/:conversationId/mute')
  @ApiOperation({
    summary: 'Unmute a conversation for the current user',
  })
  @ApiParam({
    name: 'conversationId',
    example: 'cm123conversation456',
  })
  unmuteConversation(
    @Session() session: UserSession,
    @Param('conversationId') conversationId: string,
  ) {
    return this.chatService.unmuteConversation(session.user.id, conversationId);
  }

  /**
   * Pins a conversation for the current user.
   *
   * Pinned chats stay at the top of this user's inbox only.
   */
  @Post('conversations/:conversationId/pin')
  @ApiOperation({
    summary: 'Pin a conversation for the current user',
  })
  @ApiParam({
    name: 'conversationId',
    example: 'cm123conversation456',
  })
  pinConversation(
    @Session() session: UserSession,
    @Param('conversationId') conversationId: string,
  ) {
    return this.chatService.pinConversation(session.user.id, conversationId);
  }

  /**
   * Unpins a conversation for the current user.
   *
   * This clears pinnedAt on the caller's participant row.
   */
  @Delete('conversations/:conversationId/pin')
  @ApiOperation({
    summary: 'Unpin a conversation for the current user',
  })
  @ApiParam({
    name: 'conversationId',
    example: 'cm123conversation456',
  })
  unpinConversation(
    @Session() session: UserSession,
    @Param('conversationId') conversationId: string,
  ) {
    return this.chatService.unpinConversation(session.user.id, conversationId);
  }

  /**
   * Archives a conversation for the current user.
   *
   * Archived conversations are hidden from the normal inbox but messages remain.
   */
  @Post('conversations/:conversationId/archive')
  @ApiOperation({
    summary: 'Archive a conversation for the current user',
  })
  @ApiParam({
    name: 'conversationId',
    example: 'cm123conversation456',
  })
  archiveConversation(
    @Session() session: UserSession,
    @Param('conversationId') conversationId: string,
  ) {
    return this.chatService.archiveConversation(
      session.user.id,
      conversationId,
    );
  }

  /**
   * Unarchives a conversation for the current user.
   *
   * This moves the conversation back to the normal accepted inbox.
   */
  @Delete('conversations/:conversationId/archive')
  @ApiOperation({
    summary: 'Unarchive a conversation for the current user',
  })
  @ApiParam({
    name: 'conversationId',
    example: 'cm123conversation456',
  })
  unarchiveConversation(
    @Session() session: UserSession,
    @Param('conversationId') conversationId: string,
  ) {
    return this.chatService.unarchiveConversation(
      session.user.id,
      conversationId,
    );
  }

  /**
   * Marks messages as delivered to the current user.
   *
   * Offline recipients keep messages as unread/undelivered until their client
   * syncs and acknowledges receipt through this endpoint.
   */
  @Post('messages/delivered')
  @ApiOperation({
    summary: 'Mark encrypted messages as delivered to the current user device',
  })
  markDelivered(
    @Session() session: UserSession,
    @Body() dto: MarkMessagesDeliveredDto,
  ) {
    return this.chatService.markDelivered(session.user.id, dto);
  }

  /**
   * Marks messages in a conversation as read by the current user.
   *
   * Read state is stored per message recipient, which supports future group
   * chat without changing this API shape.
   */
  @Post('conversations/:conversationId/read')
  @ApiOperation({
    summary: 'Mark messages in a conversation as read by the current user',
  })
  @ApiParam({
    name: 'conversationId',
    example: 'cm123conversation456',
  })
  markRead(
    @Session() session: UserSession,
    @Param('conversationId') conversationId: string,
    @Body() dto: MarkConversationReadDto,
  ) {
    return this.chatService.markRead(session.user.id, conversationId, dto);
  }

  /**
   * Creates a custom game emote.
   *
   * GameModeratorGuard allows app admins and moderators assigned to this game.
   * The service keeps the same permission check as a second safety layer.
   */
  @Post('games/:gameId/emotes')
  @UseGuards(GameModeratorGuard)
  @ApiCookieAuth('better-auth.session_token')
  @ApiOperation({
    summary: 'Create custom game chat emote. Admin or game moderator only.',
  })
  @ApiParam({
    name: 'gameId',
    example: 'cm123game456',
  })
  createGameEmote(
    @Session() session: UserSession,
    @Param('gameId') gameId: string,
    @Body() dto: CreateChatEmoteDto,
  ) {
    return this.chatService.createGameEmote(session.user.id, gameId, dto);
  }

  /**
   * Adds/changes the current user's reaction to a message.
   *
   * One user can have one reaction per message. Reacting again updates the
   * existing reaction instead of creating a duplicate.
   */
  @Post('messages/:messageId/reactions')
  @ApiOperation({
    summary: 'React to a chat message',
  })
  @ApiParam({
    name: 'messageId',
    example: 'cm123message456',
  })
  reactToMessage(
    @Session() session: UserSession,
    @Param('messageId') messageId: string,
    @Body() dto: ReactToMessageDto,
  ) {
    return this.chatService.reactToMessage(session.user.id, messageId, dto);
  }

  /**
   * Removes the current user's reaction from a message.
   *
   * Only removes the caller's reaction, never touches reactions from
   * other users.
   */
  @Delete('messages/:messageId/reactions')
  @ApiOperation({
    summary: 'Remove current user reaction from a chat message',
  })
  @ApiParam({
    name: 'messageId',
    example: 'cm123message456',
  })
  removeReaction(
    @Session() session: UserSession,
    @Param('messageId') messageId: string,
  ) {
    return this.chatService.removeReaction(session.user.id, messageId);
  }

  /**
   * Edits the current user's own encrypted message.
   *
   * The frontend must send a newly encrypted ciphertext payload. The backend
   * replaces the stored ciphertext and marks editedAt.
   */
  @Patch('messages/:messageId')
  @ApiOperation({
    summary: 'Edit current user chat message',
  })
  @ApiParam({
    name: 'messageId',
    example: 'cm123message456',
  })
  editMessage(
    @Session() session: UserSession,
    @Param('messageId') messageId: string,
    @Body() dto: EditMessageDto,
  ) {
    return this.chatService.editMessage(session.user.id, messageId, dto);
  }

  /**
   * Soft deletes the current user's own message.
   *
   * The message record remains for history consistency, but encrypted content
   * is cleared and status becomes DELETED.
   */
  @Delete('messages/:messageId')
  @ApiOperation({
    summary: 'Delete current user chat message',
  })
  @ApiParam({
    name: 'messageId',
    example: 'cm123message456',
  })
  deleteMessage(
    @Session() session: UserSession,
    @Param('messageId') messageId: string,
  ) {
    return this.chatService.deleteMessage(session.user.id, messageId);
  }
}
