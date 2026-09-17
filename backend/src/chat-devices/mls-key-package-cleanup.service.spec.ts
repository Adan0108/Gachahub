import { MlsKeyPackageCleanupService } from './mls-key-package-cleanup.service';

describe('MlsKeyPackageCleanupService', () => {
  const chatDevicesRepository = {
    deleteExpiredKeyPackages: jest.fn(),
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
