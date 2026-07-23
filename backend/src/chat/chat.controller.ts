import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Session } from '@thallesp/nestjs-better-auth';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { ChatService } from './chat.service';
import { CreateDirectMessageDto } from './dto/create-direct-message.dto';
import { EditMessageDto } from './dto/edit-message.dto';
import { MarkConversationReadDto } from './dto/mark-conversation-read.dto';
import { MarkMessagesDeliveredDto } from './dto/mark-messages-delivered.dto';
import { QueryChatMessagesDto } from './dto/query-chat-messages.dto';
import { ReactToMessageDto } from './dto/react-to-message.dto';
import { SendMessageDto } from './dto/send-message.dto';

@ApiTags('Chat')
@ApiCookieAuth('better-auth.session_token')
@Controller('chat')
/**
 * Controller responsible for chat HTTP routes.
 *
 * Responsibility's:
 * - Read route params, query params, request bodies, and current session user
 * - Call ChatService
 * - Keep chat business rules out of the HTTP layer
 */
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  /**
   * Creates or reuses a direct convo and sends the first message.
   *
   * This endpoint accepts encrypted client payloads only. The baclend stores
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
   * Sends an encrypted message in an existing conversation
   *
   * Service logic validates that the sender is an active participant and that
   * the recipient has not declined or blocked the conversation.
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
   * Adds/changes the current user's reaction to a message.
   *
   * One user can have one reaction per message. Reacting again updates the
   * existing reaction instead of creating dupe
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
   * Only remoevs the caller's reaction, never touches reactions from
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
