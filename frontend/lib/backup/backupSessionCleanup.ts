import { registerSessionCleanup } from '../sessionCleanup';

// Imported for its side effect; loads the runtime lazily so pages without chat stay light.
registerSessionCleanup(async () => {
  const { endBackupSession } = await import('./backupRuntime');
  await endBackupSession();
});
