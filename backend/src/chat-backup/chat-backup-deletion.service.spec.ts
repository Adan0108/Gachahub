import { ChatBackupDeletionService } from './chat-backup-deletion.service';
import { MAX_DELETIONS_PER_RUN } from './chat-backup.constants';

describe('ChatBackupDeletionService', () => {
  const repository = {
    findDueDeletions: jest.fn(),
    deleteAll: jest.fn(),
  };
  const discord = { sendError: jest.fn() };
  let service: ChatBackupDeletionService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new ChatBackupDeletionService(
      repository as never,
      discord as never,
    );
    repository.deleteAll.mockResolvedValue(true);
  });

  it('deletes each due user with the run time as the due guard', async () => {
    repository.findDueDeletions.mockResolvedValue(['a', 'b']);

    await service.deleteDueBackups();

    const [now, take] = repository.findDueDeletions.mock.calls[0] as [
      Date,
      number,
    ];
    expect(take).toBe(MAX_DELETIONS_PER_RUN);
    expect(repository.deleteAll).toHaveBeenCalledTimes(2);
    expect(repository.deleteAll).toHaveBeenCalledWith('a', now);
    expect(repository.deleteAll).toHaveBeenCalledWith('b', now);
  });

  it('deletes nothing when no schedule is due', async () => {
    repository.findDueDeletions.mockResolvedValue([]);

    await service.deleteDueBackups();

    expect(repository.deleteAll).not.toHaveBeenCalled();
  });

  it('reports a failing user to Discord and still deletes the rest', async () => {
    repository.findDueDeletions.mockResolvedValue(['a', 'b']);
    repository.deleteAll.mockRejectedValueOnce(new Error('boom'));

    await service.deleteDueBackups();

    expect(repository.deleteAll).toHaveBeenCalledTimes(2);
    expect(discord.sendError).toHaveBeenCalledTimes(1);
  });

  it('reports a failed lookup to Discord', async () => {
    repository.findDueDeletions.mockRejectedValue(new Error('db down'));

    await service.deleteDueBackups();

    expect(discord.sendError).toHaveBeenCalledTimes(1);
    expect(repository.deleteAll).not.toHaveBeenCalled();
  });
});
