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
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Session } from '@thallesp/nestjs-better-auth';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { ReactToMessageDto } from '../chat/dto/react-to-message.dto';
import { CommunityActionsService } from './community-actions.service';
import { CommunityChannelsService } from './community-channels.service';
import { CommunityMentionsService } from './community-mentions.service';
import { CommunityMessagingService } from './community-messaging.service';
import { DeleteCommunityMessageDto } from './dto/delete-community-message.dto';
import { EditCommunityMessageDto } from './dto/edit-community-message.dto';
import { MarkCommunityReadDto } from './dto/mark-community-read.dto';
import { QueryCommunityMessagesDto } from './dto/query-community-messages.dto';
import { SearchCommunityMembersDto } from './dto/search-community-members.dto';
import { SendCommunityMessageDto } from './dto/send-community-message.dto';
import { CommunitySanctionBoundary } from '../moderation-enforcement/community-sanction-boundary';

/** Chat rooms of one game community; only its members, moderators and admins get in. */
@ApiTags('Community chat')
@ApiCookieAuth('better-auth.session_token')
@Controller('games/:gameSlug/chat')
@CommunitySanctionBoundary()
export class CommunityChatController {
  constructor(
    private readonly channels: CommunityChannelsService,
    private readonly messaging: CommunityMessagingService,
    private readonly actions: CommunityActionsService,
    private readonly mentions: CommunityMentionsService,
  ) {}

  @Get()
  @ApiOperation({
    summary: "List a community's chat rooms with your unread counts",
  })
  listChannels(
    @Param('gameSlug') slug: string,
    @Session() session: UserSession,
  ) {
    return this.channels.listChannels(slug, session.user.id);
  }

  @Get('members')
  @ApiOperation({
    summary: 'Members to suggest while typing an @mention',
  })
  searchMembers(
    @Param('gameSlug') slug: string,
    @Query() query: SearchCommunityMembersDto,
    @Session() session: UserSession,
  ) {
    return this.mentions.searchMembers(slug, query.q, session.user.id);
  }

  @Get('channels/:channelId/messages')
  @ApiOperation({
    summary: 'Read a room, newest page first; pass before to go further back',
  })
  listMessages(
    @Param('gameSlug') slug: string,
    @Param('channelId') channelId: string,
    @Query() query: QueryCommunityMessagesDto,
    @Session() session: UserSession,
  ) {
    return this.messaging.listMessages(slug, channelId, query, session.user.id);
  }

  @Post('channels/:channelId/messages')
  @ApiOperation({ summary: 'Send a message to a room' })
  send(
    @Param('gameSlug') slug: string,
    @Param('channelId') channelId: string,
    @Body() dto: SendCommunityMessageDto,
    @Session() session: UserSession,
  ) {
    return this.messaging.send(slug, channelId, dto, session.user.id);
  }

  @Post('channels/:channelId/read')
  @ApiOperation({ summary: 'Mark a room read up to a message' })
  markRead(
    @Param('gameSlug') slug: string,
    @Param('channelId') channelId: string,
    @Body() dto: MarkCommunityReadDto,
    @Session() session: UserSession,
  ) {
    return this.channels.markRead(slug, channelId, dto, session.user.id);
  }

  @Get('messages/:messageId')
  @ApiOperation({ summary: 'One message, as you see it' })
  getMessage(
    @Param('gameSlug') slug: string,
    @Param('messageId') messageId: string,
    @Session() session: UserSession,
  ) {
    return this.messaging.getMessage(slug, messageId, session.user.id);
  }

  @Patch('messages/:messageId')
  @ApiOperation({ summary: 'Edit your own message (within 15 minutes)' })
  edit(
    @Param('gameSlug') slug: string,
    @Param('messageId') messageId: string,
    @Body() dto: EditCommunityMessageDto,
    @Session() session: UserSession,
  ) {
    return this.actions.edit(slug, messageId, dto, session.user.id);
  }

  @Delete('messages/:messageId')
  @ApiOperation({
    summary: 'Remove your own message, or any message as a moderator',
  })
  remove(
    @Param('gameSlug') slug: string,
    @Param('messageId') messageId: string,
    @Body() dto: DeleteCommunityMessageDto,
    @Session() session: UserSession,
  ) {
    return this.actions.remove(slug, messageId, dto, session.user.id);
  }

  @Post('messages/:messageId/reactions')
  @ApiOperation({
    summary:
      'React with an emoji or a custom emote, replacing your last reaction',
  })
  react(
    @Param('gameSlug') slug: string,
    @Param('messageId') messageId: string,
    @Body() dto: ReactToMessageDto,
    @Session() session: UserSession,
  ) {
    return this.actions.react(slug, messageId, dto, session.user.id);
  }

  @Delete('messages/:messageId/reactions')
  @ApiOperation({ summary: 'Take back your reaction' })
  unreact(
    @Param('gameSlug') slug: string,
    @Param('messageId') messageId: string,
    @Session() session: UserSession,
  ) {
    return this.actions.unreact(slug, messageId, session.user.id);
  }
}
