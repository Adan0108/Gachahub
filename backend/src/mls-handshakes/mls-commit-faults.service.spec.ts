import { ForbiddenException, NotFoundException } from '@nestjs/common';
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
jest.mock('./mls-group-info.repository', () => ({
  MlsGroupInfoRepository: class {},
}));

import { MlsCommitFaultsService } from './mls-commit-faults.service';

describe('MlsCommitFaultsService', () => {
  const repository = {
    isEntitledParticipant: jest.fn(),
    findHandshakeByEpoch: jest.fn(),
    recordCommitFault: jest.fn(),
  };
  const chatDevicesService = { assertOwnActiveDevice: jest.fn() };
  const discordLogger = { sendError: jest.fn() };
  const groupInfoRepository = { deleteIfDescribesEpoch: jest.fn() };

  let service: MlsCommitFaultsService;

  const dto = {
    deviceId: 'device-2',
    epoch: 4,
    reason: 'added an unrecorded device',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    repository.isEntitledParticipant.mockResolvedValue(true);
    repository.findHandshakeByEpoch.mockResolvedValue({
      senderDeviceId: 'device-9',
    });
    repository.recordCommitFault.mockResolvedValue(true);
    chatDevicesService.assertOwnActiveDevice.mockResolvedValue({});

    service = new MlsCommitFaultsService(
      repository as unknown as MlsHandshakesRepository,
      chatDevicesService as unknown as ChatDevicesService,
      discordLogger as unknown as DiscordLoggerService,
      groupInfoRepository as never,
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

  it('only accepts a report from a member of the conversation', async () => {
    repository.isEntitledParticipant.mockResolvedValue(false);

    await expect(service.reportFault('user-1', 'conv-1', dto)).rejects.toThrow(
      ForbiddenException,
    );

    expect(repository.recordCommitFault).not.toHaveBeenCalled();
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
