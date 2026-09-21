import { Controller, Get, Param, Patch, Query } from '@nestjs/common';

import { Session, type UserSession } from '@thallesp/nestjs-better-auth';

import { GetNotificationsQueryDto } from './dto/get-notifications-query.dto';
import { NotificationService } from './notification.service';

@Controller('notifications')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  /**
   * Returns notifications belonging to the authenticated user.
   */
  @Get()
  getNotifications(
    @Session() session: UserSession,
    @Query() query: GetNotificationsQueryDto,
  ) {
    return this.notificationService.getNotifications(session.user.id, query);
  }

  /**
   * Returns the authenticated user's unread notification count.
   */
  @Get('unread-count')
  getUnreadCount(@Session() session: UserSession) {
    return this.notificationService.getUnreadCount(session.user.id);
  }

  /**
   * Marks all notifications belonging to the authenticated user as read.
   */
  @Patch('read-all')
  markAllAsRead(@Session() session: UserSession) {
    return this.notificationService.markAllAsRead(session.user.id);
  }

  /**
   * Marks one notification belonging to the authenticated user as read.
   */
  @Patch(':id/read')
  markAsRead(
    @Session() session: UserSession,
    @Param('id') notificationId: string,
  ) {
    return this.notificationService.markAsRead(session.user.id, notificationId);
  }
}
