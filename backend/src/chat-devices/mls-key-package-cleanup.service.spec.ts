import { MlsKeyPackageCleanupService } from './mls-key-package-cleanup.service';

describe('MlsKeyPackageCleanupService', () => {
  const chatDevicesRepository = {
    deleteExpiredKeyPackages: jest.fn(),
    retireDevicesUnseenSince: jest.fn(),
  };

  const discordLogger = {
    sendError: jest.fn(),
  };

  let service: MlsKeyPackageCleanupService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new MlsKeyPackageCleanupService(
      chatDevicesRepository as any,
      discordLogger as any,
    );
  });

  it('retires devices nobody has used for two months', async () => {
    chatDevicesRepository.retireDevicesUnseenSince.mockResolvedValue(2);

    await service.retireDormantDevices();

    const [cutoff] = chatDevicesRepository.retireDevicesUnseenSince.mock
      .calls[0] as [Date];
    const daysAgo = (Date.now() - cutoff.getTime()) / (24 * 60 * 60 * 1000);
    expect(Math.round(daysAgo)).toBe(60);
    expect(discordLogger.sendError).not.toHaveBeenCalled();
  });

  it('reports a failed retirement run to discord instead of throwing', async () => {
    chatDevicesRepository.retireDevicesUnseenSince.mockRejectedValue(
      new Error('db down'),
    );

    await expect(service.retireDormantDevices()).resolves.toBeUndefined();

    expect(discordLogger.sendError).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Cron job failed: retireDormantDevices',
      }),
    );
  });

  it('deletes expired key packages without reporting an error', async () => {
    chatDevicesRepository.deleteExpiredKeyPackages.mockResolvedValue(3);

    await service.cleanupExpiredKeyPackages();

    expect(chatDevicesRepository.deleteExpiredKeyPackages).toHaveBeenCalled();
    expect(discordLogger.sendError).not.toHaveBeenCalled();
  });

  it('reports to discord instead of throwing when the delete fails', async () => {
    chatDevicesRepository.deleteExpiredKeyPackages.mockRejectedValue(
      new Error('db down'),
    );

    await expect(service.cleanupExpiredKeyPackages()).resolves.toBeUndefined();

    expect(discordLogger.sendError).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'cron',
        title: 'Cron job failed: cleanupExpiredKeyPackages',
      }),
    );
  });
});
