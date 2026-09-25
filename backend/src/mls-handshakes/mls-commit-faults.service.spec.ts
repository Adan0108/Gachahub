import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { RateLimitedException } from '../common/exceptions/rate-limited.exception';
import type { ChatDevicesService } from '../chat-devices/chat-devices.service';
import type { DiscordLoggerService } from '../common/discord/discord-logger.service';
import type { MlsHandshakesRepository } from './mls-handshakes.repository';

jest.mock('../chat-devices/chat-devices.service', () => ({
  ChatDevicesService: class {},
}));
jest.mock('../common/discord/discord-logger.service', () => ({
  DiscordLoggerService: class {},
}));
jest.mock('./mls-handshakes.repository', () => ({
  MlsHandshakesRepository: class {},
}));
jest.mock('../mls-group-roster/mls-group-roster.repository', () => ({
  MlsGroupRosterRepository: class {},
}));
jest.mock('./mls-group-info.repository', () => ({
  MlsGroupInfoRepository: class {},
}));

import { MlsCommitFaultsService } from './mls-commit-faults.service';

describe('MlsCommitFaultsService', () => {
  const repository = {
    findHandshakeByEpoch: jest.fn(),
    recordCommitFault: jest.fn(),
  };
  const participantStates = { findState: jest.fn() };
  const chatDevicesService = { assertOwnActiveDevice: jest.fn() };
  const discordLogger = { sendError: jest.fn() };
  const groupInfoRepository = {
    deleteIfDescribesEpoch: jest.fn(),
    describesEpoch: jest.fn(),
  };
  const roster = { findActiveLeaves: jest.fn() };
  const rateLimiter = {
    assertMayReport: jest.fn(),
    tryConsumeSnapshotDeletion: jest.fn(),
  };

  let service: MlsCommitFaultsService;

  const dto = {
    deviceId: 'device-2',
    epoch: 4,
    reason: 'added an unrecorded device',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    rateLimiter.assertMayReport.mockReset();
    chatDevicesService.assertOwnActiveDevice.mockReset();
    participantStates.findState.mockResolvedValue('ACTIVE');
    rateLimiter.tryConsumeSnapshotDeletion.mockReturnValue(true);
    groupInfoRepository.describesEpoch.mockResolvedValue(true);
    repository.findHandshakeByEpoch.mockResolvedValue({
      senderDeviceId: 'device-9',
    });
    repository.recordCommitFault.mockResolvedValue(true);
    chatDevicesService.assertOwnActiveDevice.mockResolvedValue({});
    roster.findActiveLeaves.mockResolvedValue([
      { deviceId: 'device-2', userId: 'user-1' },
    ]);

    service = new MlsCommitFaultsService(
      repository as unknown as MlsHandshakesRepository,
      chatDevicesService as unknown as ChatDevicesService,
      discordLogger as unknown as DiscordLoggerService,
      groupInfoRepository as never,
      roster as never,
      rateLimiter as never,
      participantStates as never,
    );
  });

  it('records which Commit was refused, who sent it, who refused it, and why', async () => {
    await expect(service.reportFault('user-1', 'conv-1', dto)).resolves.toEqual(
      { recorded: true },
    );

    expect(repository.recordCommitFault).toHaveBeenCalledWith({
      conversationId: 'conv-1',
      epoch: 4,
      senderDeviceId: 'device-9',
      reporterDeviceId: 'device-2',
      reason: 'added an unrecorded device',
    });
  });

  it('discards the snapshot the faulted commit published, so nobody self-joins from a refused state', async () => {
    await service.reportFault('user-1', 'conv-1', dto);

    expect(groupInfoRepository.deleteIfDescribesEpoch).toHaveBeenCalledWith(
      'conv-1',
      dto.epoch + 1,
    );
  });

  it('spends no snapshot-deletion budget when no snapshot exists at that epoch', async () => {
    groupInfoRepository.describesEpoch.mockResolvedValue(false);

    await expect(service.reportFault('user-1', 'conv-1', dto)).resolves.toEqual(
      { recorded: true },
    );

    expect(groupInfoRepository.describesEpoch).toHaveBeenCalledWith(
      'conv-1',
      dto.epoch + 1,
    );
    expect(rateLimiter.tryConsumeSnapshotDeletion).not.toHaveBeenCalled();
    expect(groupInfoRepository.deleteIfDescribesEpoch).not.toHaveBeenCalled();
  });

  it('alerts Discord the first time, naming the sender', async () => {
    await service.reportFault('user-1', 'conv-1', dto);

    expect(discordLogger.sendError).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'mls',
        dedupKey: 'MlsCommitRefused:conv-1:4',
        fields: expect.arrayContaining([
          expect.objectContaining({
            name: 'Sender device',
            value: 'device-9',
          }) as unknown,
        ]) as unknown,
      }),
    );
  });

  it('shows the reporter’s text as code, so a link in it is not clickable in the alert', async () => {
    await service.reportFault('user-1', 'conv-1', {
      ...dto,
      reason: '[Reset admin session](https://evil) `x`',
    });

    const [alert] = discordLogger.sendError.mock.calls[0] as [
      { fields: Array<{ name: string; value: string }> },
    ];
    const reason = alert.fields.find((field) => field.name === 'Reason');
    expect(reason?.value).toBe("`[Reset admin session](https://evil) 'x'`");
  });

  it('does not alert again when the same fault is filed again - every poll re-detects it', async () => {
    repository.recordCommitFault.mockResolvedValue(false);

    await expect(service.reportFault('user-1', 'conv-1', dto)).resolves.toEqual(
      { recorded: false },
    );

    expect(discordLogger.sendError).not.toHaveBeenCalled();
  });

  it('still records and alerts, but keeps the snapshot, once the conversation used up its snapshot-deleting reports', async () => {
    rateLimiter.tryConsumeSnapshotDeletion.mockReturnValue(false);

    await expect(service.reportFault('user-1', 'conv-1', dto)).resolves.toEqual(
      { recorded: true },
    );

    expect(rateLimiter.tryConsumeSnapshotDeletion).toHaveBeenCalledWith(
      'conv-1',
    );
    expect(groupInfoRepository.deleteIfDescribesEpoch).not.toHaveBeenCalled();
    expect(discordLogger.sendError).toHaveBeenCalled();
  });

  it('spends no snapshot-deletion budget on a repeated report', async () => {
    repository.recordCommitFault.mockResolvedValue(false);

    await service.reportFault('user-1', 'conv-1', dto);

    expect(rateLimiter.tryConsumeSnapshotDeletion).not.toHaveBeenCalled();
  });

  it('only accepts a report from a member of the conversation', async () => {
    participantStates.findState.mockResolvedValue('PENDING');

    await expect(service.reportFault('user-1', 'conv-1', dto)).rejects.toThrow(
      ForbiddenException,
    );

    expect(repository.recordCommitFault).not.toHaveBeenCalled();
  });

  it('refuses a device that is not a leaf of the group, or is a leaf of another user', async () => {
    roster.findActiveLeaves.mockResolvedValue([
      { deviceId: 'device-2', userId: 'user-other' },
    ]);

    await expect(service.reportFault('user-1', 'conv-1', dto)).rejects.toThrow(
      ForbiddenException,
    );

    roster.findActiveLeaves.mockResolvedValue([]);
    await expect(service.reportFault('user-1', 'conv-1', dto)).rejects.toThrow(
      ForbiddenException,
    );
    expect(repository.recordCommitFault).not.toHaveBeenCalled();
  });

  it('is rate limited per user, before any lookup', async () => {
    rateLimiter.assertMayReport.mockImplementation(() => {
      throw new RateLimitedException('slow down', 30);
    });

    await expect(service.reportFault('user-1', 'conv-1', dto)).rejects.toThrow(
      RateLimitedException,
    );

    expect(rateLimiter.assertMayReport).toHaveBeenCalledWith('user-1');
    expect(participantStates.findState).not.toHaveBeenCalled();
  });

  it('only accepts a report from a device the caller owns', async () => {
    chatDevicesService.assertOwnActiveDevice.mockRejectedValue(
      new NotFoundException('Device not found'),
    );

    await expect(service.reportFault('user-1', 'conv-1', dto)).rejects.toThrow(
      NotFoundException,
    );

    expect(repository.recordCommitFault).not.toHaveBeenCalled();
  });

  it('refuses a report about an epoch where no Commit was accepted, which also bounds how many faults one member can file', async () => {
    repository.findHandshakeByEpoch.mockResolvedValue(null);

    await expect(
      service.reportFault('user-1', 'conv-1', { ...dto, epoch: 9999 }),
    ).rejects.toThrow(NotFoundException);

    expect(repository.recordCommitFault).not.toHaveBeenCalled();
  });

  it('still records a fault whose sender device has since been deleted', async () => {
    repository.findHandshakeByEpoch.mockResolvedValue({ senderDeviceId: null });

    await service.reportFault('user-1', 'conv-1', dto);

    expect(repository.recordCommitFault).toHaveBeenCalledWith(
      expect.objectContaining({ senderDeviceId: null }),
    );
  });
});
