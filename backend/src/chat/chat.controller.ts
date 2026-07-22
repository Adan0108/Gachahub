import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
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
import { MarkConversationReadDto } from './dto/mark-conversation-read.dto';
import { MarkMessagesDeliveredDto } from './dto/mark-messages-delivered.dto';
import { QueryChatMessagesDto } from './dto/query-chat-messages.dto';
import { ReactToMessageDto } from './dto/react-to-message.dto';
import { SendMessageDto } from './dto/send-message.dto';

@ApiTags('Chat')
@ApiCookieAuth('better-auth.session_token')
@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

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

  @Get('conversations')
  @ApiOperation({
    summary: 'List accepted chat conversations for the current user',
  })
  listConversations(@Session() session: UserSession) {
    return this.chatService.listConversations(session.user.id);
  }

  @Get('requests')
  @ApiOperation({
    summary: 'List pending stranger message requests for the current user',
  })
  listMessageRequests(@Session() session: UserSession) {
    return this.chatService.listMessageRequests(session.user.id);
  }

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
    return this.chatService.sendMessage(
      session.user.id,
      conversationId,
      dto,
    );
  }

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
}
