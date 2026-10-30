'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { recoveryKeyMessage } from '../../lib/backup/backupDeletion';
import { formatRecoveryKey, generateBackupKey, parseRecoveryKey } from '../../lib/backup/backupKey';
import { backupHoldsKeyKey, backupStatusKey } from '../../lib/backup/backupQueryKeys';
import type { RestoreProgress, RestoreResult } from '../../lib/backup/backupRestore';
import {
  cancelBackupDeletion,
  isRestorePending,
  disableBackup,
  enableBackup,
  onBackupDisabledElsewhere,
  resumeBackup,
  resumeRestore,
  restoreOnThisDevice,
  scheduleBackupDeletion,
  type BackupStatus,
} from '../../lib/backup/backupRuntime';

export type RestoreState =
  | { status: 'idle' }
  | { status: 'running'; progress: RestoreProgress }
  | { status: 'done'; result: RestoreResult }
  | { status: 'error'; message: string };

interface PendingKey {
  raw: Uint8Array;
  text: string;
}

/** Encrypted history backup: status, key holding, turning on/off, and restore; mount once on the chat page so uploads resume. */
export function useChatBackup(userId: string | undefined) {
  const queryClient = useQueryClient();
  const statusKey = backupStatusKey(userId);
  const holdsKeyKey = backupHoldsKeyKey(userId);
  const status = useQuery({
    queryKey: statusKey,
    queryFn: () => api.getChatBackupStatus() as Promise<BackupStatus>,
    enabled: Boolean(userId),
    retry: 1,
    staleTime: 30_000,
  });

  // Whether this browser holds the working key; also restarts uploads after a reload.
  const holdsKey = useQuery({
    queryKey: [...holdsKeyKey, status.data?.keyCheck ?? null],
    queryFn: () => resumeBackup(userId!, status.data!),
    enabled: Boolean(userId) && status.isSuccess,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  });
  // True while a restore on this device was started but never finished, even though it now holds the key.
  const restorePending = useQuery({
    queryKey: [...holdsKeyKey, 'restorePending'],
    queryFn: isRestorePending,
    enabled: Boolean(userId),
    staleTime: Infinity,
    gcTime: Infinity,
  });
  // Exact: the key check sits under the status key, and re-running it against the status from before
  // a change would read "backup off" and wipe the key this browser holds.
  const refresh = () => queryClient.invalidateQueries({ queryKey: statusKey, exact: true });

  const [disabledElsewhere, setDisabledElsewhere] = useState(false);
  useEffect(
    () =>
      onBackupDisabledElsewhere(() => {
        setDisabledElsewhere(true);
        queryClient.removeQueries({ queryKey: backupHoldsKeyKey(userId) });
        void queryClient.invalidateQueries({ queryKey: backupStatusKey(userId), exact: true });
      }),
    [queryClient, userId],
  );

  const [pendingKey, setPendingKey] = useState<PendingKey | null>(null);
  const pendingRef = useRef<PendingKey | null>(null);
  // Every replaced or dropped key is zeroed, so it never lingers in memory.
  const replacePending = useCallback((next: PendingKey | null) => {
    pendingRef.current?.raw.fill(0);
    pendingRef.current = next;
    setPendingKey(next);
  }, []);

  const abortRef = useRef<AbortController | undefined>(undefined);
  useEffect(
    () => () => {
      pendingRef.current?.raw.fill(0);
      abortRef.current?.abort();
    },
    [],
  );

  const beginEnable = useCallback(async () => {
    const raw = generateBackupKey();
    replacePending({ raw, text: await formatRecoveryKey(raw) });
  }, [replacePending]);
  const cancelEnable = useCallback(() => replacePending(null), [replacePending]);

  const confirmEnable = useMutation({
    mutationFn: async () => {
      if (!pendingKey || !userId) throw new Error('No recovery key to save');
      await enableBackup(userId, pendingKey.raw);
    },
    onSuccess: async () => {
      setDisabledElsewhere(false);
      replacePending(null);
      // Status first, for the same reason as `refresh`.
      await refresh();
      queryClient.removeQueries({ queryKey: holdsKeyKey });
    },
    // Most likely another device turned it on first; the fresh status says so.
    onError: refresh,
  });

  const turnOff = useMutation({
    mutationFn: () => disableBackup(userId!),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: holdsKeyKey });
      return refresh();
    },
  });

  const scheduleDeletion = useMutation({
    mutationFn: scheduleBackupDeletion,
    onSuccess: refresh,
  });

  // With no argument, cancels using the key this device holds; otherwise with the typed key.
  const cancelDeletion = useMutation({
    mutationFn: async (recoveryKeyText?: string) => {
      let rawKey: Uint8Array | undefined;
      try {
        rawKey = recoveryKeyText ? await parseRecoveryKey(recoveryKeyText) : undefined;
        await cancelBackupDeletion(userId!, rawKey);
      } finally {
        rawKey?.fill(0);
      }
    },
    onSuccess: refresh,
  });

  const [restoreState, setRestoreState] = useState<RestoreState>({ status: 'idle' });

  // Shared by a first restore and a resume: progress, outcome and the follow-up refresh.
  const runRestoreFlow = useCallback(
    async (start: (options: Parameters<typeof resumeRestore>[1]) => Promise<RestoreResult | 'wrong-key'>) => {
      if (!userId) return;
      try {
        const controller = new AbortController();
        abortRef.current = controller;
        const empty = { processed: 0, restored: 0, skipped: 0, failed: 0 };
        setRestoreState({ status: 'running', progress: empty });
        const outcome = await start({
          signal: controller.signal,
          onProgress: (progress) => setRestoreState({ status: 'running', progress }),
        });
        if (outcome === 'wrong-key') {
          setRestoreState({ status: 'error', message: 'That key does not match this backup.' });
          return;
        }
        setRestoreState({ status: 'done', result: outcome });
        setDisabledElsewhere(false);
        await queryClient.invalidateQueries({ queryKey: backupStatusKey(userId), exact: true });
        queryClient.removeQueries({ queryKey: backupHoldsKeyKey(userId) });
      } catch (error) {
        const message = recoveryKeyMessage(
          error,
          "Couldn't finish restoring. Check your connection and try again.",
        );
        setRestoreState({ status: 'error', message });
      } finally {
        // Stopped or failed runs leave the unfinished mark; a finished one clears it.
        void queryClient.invalidateQueries({ queryKey: [...backupHoldsKeyKey(userId), 'restorePending'] });
      }
    },
    [userId, queryClient],
  );

  const restore = useCallback(
    async (recoveryKeyText: string) => {
      if (!userId || !status.data) return;
      let rawKey: Uint8Array | undefined;
      try {
        rawKey = await parseRecoveryKey(recoveryKeyText);
        const key = rawKey;
        await runRestoreFlow((options) => restoreOnThisDevice(userId, key, status.data!, options));
      } catch (error) {
        setRestoreState({
          status: 'error',
          message: recoveryKeyMessage(error, "Couldn't finish restoring. Check your connection and try again."),
        });
      } finally {
        rawKey?.fill(0);
      }
    },
    [userId, status.data, runRestoreFlow],
  );

  // For a device that already holds the key: carries on where an interrupted restore stopped.
  const resumeInterruptedRestore = useCallback(
    () => runRestoreFlow((options) => resumeRestore(userId!, options)),
    [userId, runRestoreFlow],
  );

  const cancelRestore = useCallback(() => abortRef.current?.abort(), []);
  const resetRestore = useCallback(() => setRestoreState({ status: 'idle' }), []);

  return {
    status,
    holdsKey: holdsKey.data === true,
    isCheckingKey: holdsKey.isLoading,
    disabledElsewhere,
    pendingKey,
    beginEnable,
    cancelEnable,
    confirmEnable,
    turnOff,
    scheduleDeletion,
    cancelDeletion,
    restoreState,
    restore,
    restorePending: restorePending.data === true,
    resumeInterruptedRestore,
    cancelRestore,
    resetRestore,
  };
}
