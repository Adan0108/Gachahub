import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import {
  NotificationEntityType,
  NotificationType,
  UserStatus,
} from '../generated/prisma/client';

import { NotificationRepository } from './notification.repository';
import { NotificationService } from './notification.service';

type NotificationRepositoryMock = {
  create: jest.MockedFunction<NotificationRepository['create']>;
  findRecipientById: jest.MockedFunction<
    NotificationRepository['findRecipientById']
  >;
  findNotifiableRecipientIds: jest.MockedFunction<
    NotificationRepository['findNotifiableRecipientIds']
  >;
  createMany: jest.MockedFunction<NotificationRepository['createMany']>;
  findByRecipient: jest.MockedFunction<
    NotificationRepository['findByRecipient']
  >;
  findByIdForRecipient: jest.MockedFunction<
    NotificationRepository['findByIdForRecipient']
  >;
  countUnread: jest.MockedFunction<NotificationRepository['countUnread']>;
  markAsRead: jest.MockedFunction<NotificationRepository['markAsRead']>;
  markAllAsRead: jest.MockedFunction<NotificationRepository['markAllAsRead']>;
  findExisting: jest.MockedFunction<NotificationRepository['findExisting']>;
};

describe('NotificationService', () => {
  let service: NotificationService;

  const repositoryMock: NotificationRepositoryMock = {
    create: jest.fn(),
    findRecipientById: jest.fn(),
    findNotifiableRecipientIds: jest.fn(),
    createMany: jest.fn(),
    findByRecipient: jest.fn(),
    findByIdForRecipient: jest.fn(),
    countUnread: jest.fn(),
    markAsRead: jest.fn(),
    markAllAsRead: jest.fn(),
    findExisting: jest.fn(),
  };

  const recipientId = 'recipient-1';
  const actorId = 'actor-1';
  const entityId = 'post-1';

  const notification = {
    id: 'notification-1',
    recipientId,
    actorId,
    type: NotificationType.POST_LIKED,
    entityType: NotificationEntityType.POST,
    entityId,
    readAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const notificationWithActor = {
    ...notification,
    actor: {
      id: actorId,
      name: 'Actor',
      image: null,
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationService,
        {
          provide: NotificationRepository,
          useValue: repositoryMock,
        },
      ],
    }).compile();

    service = module.get<NotificationService>(NotificationService);

    jest.clearAllMocks();
  });

  describe('createNotification', () => {
    it('should create a notification', async () => {
      repositoryMock.findRecipientById.mockResolvedValue({
        id: recipientId,
        status: UserStatus.ACTIVE,
      });

      repositoryMock.findExisting.mockResolvedValue(null);

      repositoryMock.create.mockResolvedValue(notification);

      const result = await service.createNotification({
        recipientId,
        actorId,
        type: NotificationType.POST_LIKED,
        entityType: NotificationEntityType.POST,
        entityId,
      });

      expect(result).toEqual(notification);

      expect(repositoryMock.findRecipientById).toHaveBeenCalledWith(
        recipientId,
        undefined,
      );

      expect(repositoryMock.findExisting).toHaveBeenCalledTimes(1);

      const findExistingParams = repositoryMock.findExisting.mock.calls[0][0];

      expect(findExistingParams.recipientId).toBe(recipientId);

      expect(findExistingParams.actorId).toBe(actorId);

      expect(findExistingParams.type).toBe(NotificationType.POST_LIKED);

      expect(findExistingParams.entityType).toBe(NotificationEntityType.POST);

      expect(findExistingParams.entityId).toBe(entityId);

      expect(findExistingParams.since).toBeInstanceOf(Date);

      expect(repositoryMock.create).toHaveBeenCalledWith(
        {
          recipientId,
          actorId,
          type: NotificationType.POST_LIKED,
          entityType: NotificationEntityType.POST,
          entityId,
        },
        undefined,
      );
    });

    it('should return null for self notification', async () => {
      const result = await service.createNotification({
        recipientId,
        actorId: recipientId,
        type: NotificationType.POST_LIKED,
        entityType: NotificationEntityType.POST,
        entityId,
      });

      expect(result).toBeNull();

      expect(repositoryMock.findRecipientById).not.toHaveBeenCalled();

      expect(repositoryMock.findExisting).not.toHaveBeenCalled();

      expect(repositoryMock.create).not.toHaveBeenCalled();
    });

    it('should return null when recipient does not exist', async () => {
      repositoryMock.findRecipientById.mockResolvedValue(null);

      const result = await service.createNotification({
        recipientId,
        actorId,
        type: NotificationType.POST_LIKED,
        entityType: NotificationEntityType.POST,
        entityId,
      });

      expect(result).toBeNull();

      expect(repositoryMock.findExisting).not.toHaveBeenCalled();

      expect(repositoryMock.create).not.toHaveBeenCalled();
    });

    it('should return null when recipient is deleted', async () => {
      repositoryMock.findRecipientById.mockResolvedValue({
        id: recipientId,
        status: UserStatus.DELETED,
      });

      const result = await service.createNotification({
        recipientId,
        actorId,
        type: NotificationType.POST_LIKED,
        entityType: NotificationEntityType.POST,
        entityId,
      });

      expect(result).toBeNull();

      expect(repositoryMock.create).not.toHaveBeenCalled();
    });

    it('should return null when recipient is banned', async () => {
      repositoryMock.findRecipientById.mockResolvedValue({
        id: recipientId,
        status: UserStatus.BANNED,
      });

      const result = await service.createNotification({
        recipientId,
        actorId,
        type: NotificationType.POST_LIKED,
        entityType: NotificationEntityType.POST,
        entityId,
      });

      expect(result).toBeNull();

      expect(repositoryMock.create).not.toHaveBeenCalled();
    });

    it('should return existing recent duplicate', async () => {
      repositoryMock.findRecipientById.mockResolvedValue({
        id: recipientId,
        status: UserStatus.ACTIVE,
      });

      repositoryMock.findExisting.mockResolvedValue(notification);

      const result = await service.createNotification({
        recipientId,
        actorId,
        type: NotificationType.POST_LIKED,
        entityType: NotificationEntityType.POST,
        entityId,
      });

      expect(result).toEqual(notification);

      expect(repositoryMock.create).not.toHaveBeenCalled();
    });

    it('should throw when recipientId is missing', async () => {
      await expect(
        service.createNotification({
          recipientId: '',
          actorId,
          type: NotificationType.POST_LIKED,
          entityType: NotificationEntityType.POST,
          entityId,
        }),
      ).rejects.toThrow(new BadRequestException('recipientId is required'));
    });

    it('should throw when entityId is missing', async () => {
      await expect(
        service.createNotification({
          recipientId,
          actorId,
          type: NotificationType.POST_LIKED,
          entityType: NotificationEntityType.POST,
          entityId: '',
        }),
      ).rejects.toThrow(new BadRequestException('entityId is required'));
    });

    it('should throw when actorId is missing', async () => {
      await expect(
        service.createNotification({
          recipientId,
          actorId: null,
          type: NotificationType.POST_LIKED,
          entityType: NotificationEntityType.POST,
          entityId,
        }),
      ).rejects.toThrow(
        new BadRequestException('actorId is required for POST_LIKED'),
      );
    });

    it('should reject POST_LIKED targeting COMMENT', async () => {
      await expect(
        service.createNotification({
          recipientId,
          actorId,
          type: NotificationType.POST_LIKED,
          entityType: NotificationEntityType.COMMENT,
          entityId,
        }),
      ).rejects.toThrow(
        new BadRequestException('POST_LIKED must target a POST'),
      );
    });

    it('should reject POST_COMMENTED targeting POST', async () => {
      await expect(
        service.createNotification({
          recipientId,
          actorId,
          type: NotificationType.POST_COMMENTED,
          entityType: NotificationEntityType.POST,
          entityId,
        }),
      ).rejects.toThrow(
        new BadRequestException('POST_COMMENTED must target a COMMENT'),
      );
    });

    it('should reject COMMENT_REPLIED targeting POST', async () => {
      await expect(
        service.createNotification({
          recipientId,
          actorId,
          type: NotificationType.COMMENT_REPLIED,
          entityType: NotificationEntityType.POST,
          entityId,
        }),
      ).rejects.toThrow(
        new BadRequestException('COMMENT_REPLIED must target a COMMENT'),
      );
    });

    it('should reject USER_FOLLOWED targeting POST', async () => {
      await expect(
        service.createNotification({
          recipientId,
          actorId,
          type: NotificationType.USER_FOLLOWED,
          entityType: NotificationEntityType.POST,
          entityId,
        }),
      ).rejects.toThrow(
        new BadRequestException('USER_FOLLOWED must target a USER'),
      );
    });

    it.each([
      NotificationEntityType.POST,
      NotificationEntityType.COMMENT,
      NotificationEntityType.MESSAGE,
    ])('should allow USER_MENTIONED targeting %s', async (entityType) => {
      repositoryMock.findRecipientById.mockResolvedValue({
        id: recipientId,
        status: UserStatus.ACTIVE,
      });

      repositoryMock.findExisting.mockResolvedValue(null);

      repositoryMock.create.mockResolvedValue({
        ...notification,
        type: NotificationType.USER_MENTIONED,
        entityType,
      });

      const result = await service.createNotification({
        recipientId,
        actorId,
        type: NotificationType.USER_MENTIONED,
        entityType,
        entityId,
      });

      expect(result).toBeDefined();
    });

    it('should reject USER_MENTIONED targeting USER', async () => {
      await expect(
        service.createNotification({
          recipientId,
          actorId,
          type: NotificationType.USER_MENTIONED,
          entityType: NotificationEntityType.USER,
          entityId,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject MESSAGE_RECEIVED targeting POST', async () => {
      await expect(
        service.createNotification({
          recipientId,
          actorId,
          type: NotificationType.MESSAGE_RECEIVED,
          entityType: NotificationEntityType.POST,
          entityId,
        }),
      ).rejects.toThrow(
        new BadRequestException('MESSAGE_RECEIVED must target a MESSAGE'),
      );
    });

    it('should reject MESSAGE_REPLIED targeting POST', async () => {
      await expect(
        service.createNotification({
          recipientId,
          actorId,
          type: NotificationType.MESSAGE_REPLIED,
          entityType: NotificationEntityType.POST,
          entityId,
        }),
      ).rejects.toThrow(
        new BadRequestException('MESSAGE_REPLIED must target a MESSAGE'),
      );
    });

    it('should reject GROUP_ADDED targeting USER', async () => {
      await expect(
        service.createNotification({
          recipientId,
          actorId,
          type: NotificationType.GROUP_ADDED,
          entityType: NotificationEntityType.USER,
          entityId,
        }),
      ).rejects.toThrow(
        new BadRequestException('GROUP_ADDED must target a CONVERSATION'),
      );
    });

    it('should reject GROUP_INVITE_PENDING targeting USER', async () => {
      await expect(
        service.createNotification({
          recipientId,
          actorId,
          type: NotificationType.GROUP_INVITE_PENDING,
          entityType: NotificationEntityType.USER,
          entityId,
        }),
      ).rejects.toThrow(
        new BadRequestException(
          'GROUP_INVITE_PENDING must target a CONVERSATION',
        ),
      );
    });
  });

  describe('createManyNotifications', () => {
    const transaction = {} as never;

    it('rejects an incompatible type/entity pairing before touching any recipient', async () => {
      await expect(
        service.createManyNotifications(
          {
            recipientIds: ['user-b'],
            actorId,
            type: NotificationType.MESSAGE_RECEIVED,
            entityType: NotificationEntityType.POST,
            entityId: 'message-1',
          },
          transaction,
        ),
      ).rejects.toThrow(BadRequestException);

      expect(repositoryMock.findNotifiableRecipientIds).not.toHaveBeenCalled();
    });

    it('drops the actor from recipientIds before checking anyone (defensive self-notification guard)', async () => {
      repositoryMock.findNotifiableRecipientIds.mockResolvedValue(['user-b']);
      repositoryMock.createMany.mockResolvedValue({ count: 1 });

      await service.createManyNotifications(
        {
          recipientIds: ['user-b', actorId],
          actorId,
          type: NotificationType.MESSAGE_RECEIVED,
          entityType: NotificationEntityType.MESSAGE,
          entityId: 'message-1',
        },
        transaction,
      );

      expect(repositoryMock.findNotifiableRecipientIds).toHaveBeenCalledWith(
        ['user-b'],
        transaction,
      );
    });

    it('returns [] without querying anything when every recipient was the actor', async () => {
      const result = await service.createManyNotifications(
        {
          recipientIds: [actorId],
          actorId,
          type: NotificationType.MESSAGE_RECEIVED,
          entityType: NotificationEntityType.MESSAGE,
          entityId: 'message-1',
        },
        transaction,
      );

      expect(result).toEqual([]);
      expect(repositoryMock.findNotifiableRecipientIds).not.toHaveBeenCalled();
      expect(repositoryMock.createMany).not.toHaveBeenCalled();
    });

    it('drops a deleted/banned recipient before creating anything, and returns [] if that empties the list', async () => {
      repositoryMock.findNotifiableRecipientIds.mockResolvedValue([]);

      const result = await service.createManyNotifications(
        {
          recipientIds: ['user-deleted'],
          actorId,
          type: NotificationType.MESSAGE_RECEIVED,
          entityType: NotificationEntityType.MESSAGE,
          entityId: 'message-1',
        },
        transaction,
      );

      expect(result).toEqual([]);
      expect(repositoryMock.createMany).not.toHaveBeenCalled();
    });

    it('creates one row per notifiable recipient with a pre-generated id, and returns those rows without reading anything back', async () => {
      repositoryMock.findNotifiableRecipientIds.mockResolvedValue([
        'user-b',
        'user-c',
      ]);
      repositoryMock.createMany.mockResolvedValue({ count: 2 });

      const result = await service.createManyNotifications(
        {
          recipientIds: ['user-b', 'user-c'],
          actorId,
          type: NotificationType.MESSAGE_RECEIVED,
          entityType: NotificationEntityType.MESSAGE,
          entityId: 'message-1',
        },
        transaction,
      );

      expect(repositoryMock.createMany).toHaveBeenCalledTimes(1);
      const [rows, calledTransaction] = repositoryMock.createMany.mock.calls[0];
      expect(calledTransaction).toBe(transaction);
      expect(rows).toHaveLength(2);
      expect(rows.map((row) => row.recipientId)).toEqual(['user-b', 'user-c']);
      for (const row of rows) {
        expect(typeof row.id).toBe('string');
        expect(row.id.length).toBeGreaterThan(0);
        expect(row).toMatchObject({
          actorId,
          type: NotificationType.MESSAGE_RECEIVED,
          entityType: NotificationEntityType.MESSAGE,
          entityId: 'message-1',
          readAt: null,
        });
      }
      // No read-back: what was passed to createMany is exactly what's returned.
      expect(result).toEqual(rows);
    });
  });

  describe('getNotifications', () => {
    it('should return paginated notifications with next cursor', async () => {
      const n1 = {
        ...notificationWithActor,
        id: 'notification-1',
      };

      const n2 = {
        ...notificationWithActor,
        id: 'notification-2',
      };

      const n3 = {
        ...notificationWithActor,
        id: 'notification-3',
      };

      repositoryMock.findByRecipient.mockResolvedValue([n1, n2, n3]);

      const result = await service.getNotifications(recipientId, {
        limit: 2,
      });

      expect(repositoryMock.findByRecipient).toHaveBeenCalledWith({
        recipientId,
        limit: 3,
        cursor: undefined,
      });

      expect(result).toEqual({
        items: [n1, n2],
        nextCursor: 'notification-2',
        hasMore: true,
      });
    });

    it('should return no next cursor when there are no more results', async () => {
      repositoryMock.findByRecipient.mockResolvedValue([notificationWithActor]);

      const result = await service.getNotifications(recipientId, {
        limit: 20,
      });

      expect(result).toEqual({
        items: [notificationWithActor],
        nextCursor: null,
        hasMore: false,
      });
    });

    it('should use default page size', async () => {
      repositoryMock.findByRecipient.mockResolvedValue([]);

      await service.getNotifications(recipientId, {});

      expect(repositoryMock.findByRecipient).toHaveBeenCalledWith({
        recipientId,
        limit: 21,
        cursor: undefined,
      });
    });

    it('should pass cursor to repository', async () => {
      repositoryMock.findByRecipient.mockResolvedValue([]);

      await service.getNotifications(recipientId, {
        cursor: 'notification-10',
      });

      expect(repositoryMock.findByRecipient).toHaveBeenCalledWith(
        expect.objectContaining({
          cursor: 'notification-10',
        }),
      );
    });

    it('should throw when recipientId is missing', async () => {
      await expect(service.getNotifications('', {})).rejects.toThrow(
        new BadRequestException('recipientId is required'),
      );
    });
  });

  describe('getUnreadCount', () => {
    it('should return unread notification count', async () => {
      repositoryMock.countUnread.mockResolvedValue(5);

      const result = await service.getUnreadCount(recipientId);

      expect(result).toEqual({
        count: 5,
      });

      expect(repositoryMock.countUnread).toHaveBeenCalledWith(recipientId);
    });

    it('should throw when recipientId is missing', async () => {
      await expect(service.getUnreadCount('')).rejects.toThrow(
        new BadRequestException('recipientId is required'),
      );
    });
  });

  describe('markAsRead', () => {
    it('should mark an unread notification as read', async () => {
      repositoryMock.findByIdForRecipient.mockResolvedValue(notification);

      repositoryMock.markAsRead.mockResolvedValue({
        count: 1,
      });

      const result = await service.markAsRead(recipientId, notification.id);

      expect(repositoryMock.findByIdForRecipient).toHaveBeenCalledWith(
        notification.id,
        recipientId,
      );

      expect(repositoryMock.markAsRead).toHaveBeenCalledTimes(1);

      const markAsReadParams = repositoryMock.markAsRead.mock.calls[0][0];

      expect(markAsReadParams.notificationId).toBe(notification.id);

      expect(markAsReadParams.recipientId).toBe(recipientId);

      expect(markAsReadParams.readAt).toBeInstanceOf(Date);

      expect(result.readAt).toBeInstanceOf(Date);
    });

    it('should return existing notification if already read', async () => {
      const alreadyRead = {
        ...notification,
        readAt: new Date(),
      };

      repositoryMock.findByIdForRecipient.mockResolvedValue(alreadyRead);

      const result = await service.markAsRead(recipientId, alreadyRead.id);

      expect(result).toEqual(alreadyRead);

      expect(repositoryMock.markAsRead).not.toHaveBeenCalled();
    });

    it('should throw when notification does not exist for recipient', async () => {
      repositoryMock.findByIdForRecipient.mockResolvedValue(null);

      await expect(
        service.markAsRead(recipientId, 'notification-missing'),
      ).rejects.toThrow(new NotFoundException('Notification not found'));

      expect(repositoryMock.markAsRead).not.toHaveBeenCalled();
    });

    it('should throw when recipientId is missing', async () => {
      await expect(service.markAsRead('', notification.id)).rejects.toThrow(
        new BadRequestException('recipientId is required'),
      );
    });

    it('should throw when notificationId is missing', async () => {
      await expect(service.markAsRead(recipientId, '')).rejects.toThrow(
        new BadRequestException('notificationId is required'),
      );
    });
  });

  describe('markAllAsRead', () => {
    it('should mark all unread notifications as read', async () => {
      repositoryMock.markAllAsRead.mockResolvedValue({
        count: 4,
      });

      const result = await service.markAllAsRead(recipientId);

      expect(repositoryMock.markAllAsRead).toHaveBeenCalledTimes(1);

      const markAllAsReadParams = repositoryMock.markAllAsRead.mock.calls[0][0];

      expect(markAllAsReadParams.recipientId).toBe(recipientId);

      expect(markAllAsReadParams.readAt).toBeInstanceOf(Date);

      expect(result.updatedCount).toBe(4);
      expect(result.readAt).toBeInstanceOf(Date);
    });

    it('should return zero when no unread notifications exist', async () => {
      repositoryMock.markAllAsRead.mockResolvedValue({
        count: 0,
      });

      const result = await service.markAllAsRead(recipientId);

      expect(result.updatedCount).toBe(0);
    });

    it('should throw when recipientId is missing', async () => {
      await expect(service.markAllAsRead('')).rejects.toThrow(
        new BadRequestException('recipientId is required'),
      );
    });
  });
});
