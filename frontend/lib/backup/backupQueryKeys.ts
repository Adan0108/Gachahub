/** Prefix of every chat-backup query; clearing it drops one account's cached backup state. */
export const CHAT_BACKUP_QUERY_ROOT = ['chat', 'backup'] as const;

export const backupStatusKey = (userId: string | undefined) =>
  [...CHAT_BACKUP_QUERY_ROOT, userId ?? null] as const;

export const backupHoldsKeyKey = (userId: string | undefined) =>
  [...backupStatusKey(userId), 'local'] as const;
