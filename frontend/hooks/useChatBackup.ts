'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { recoveryKeyMessage } from '../lib/backup/backupDeletion';
import { formatRecoveryKey, generateBackupKey, parseRecoveryKey } from '../lib/backup/backupKey';
import { backupHoldsKeyKey, backupStatusKey } from '../lib/backup/backupQueryKeys';
import type { RestoreProgress, RestoreResult } from '../lib/backup/backupRestore';
import {
  cancelBackupDeletion,
  disableBackup,
  enableBackup,
  onBackupDisabledElsewhere,
  resumeBackup,
  restoreOnThisDevice,
  scheduleBackupDeletion,
  type BackupStatus,
} from '../lib/backup/backupRuntime';

export type RestoreState =
  | { status: 'idle' }
  | { status: 'running'; progress: RestoreProgress }
  | { status: 'done'; result: RestoreResult }
  | { status: 'error'; message: string };

interface PendingKey {
  raw: Uint8Array;
  text: string;
}

/**
 * Encrypted history backup: server status, whether this device holds the key (and so keeps
 * uploading), turning it on (key shown once), off (at once with the key, else scheduled), and
 * restoring on a new device. Mount it once
 * on the chat page so uploads resume after every reload, not only while the modal is open.
 */
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
  const refresh = () => queryClient.invalidateQueries({ queryKey: statusKey });

  const [disabledElsewhere, setDisabledElsewhere] = useState(false);
  useEffect(
    () =>
      onBackupDisabledElsewhere(() => {
        setDisabledElsewhere(true);
        queryClient.removeQueries({ queryKey: backupHoldsKeyKey(userId) });
        void queryClient.invalidateQueries({ queryKey: backupStatusKey(userId) });
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
    onSuccess: () => {
      setDisabledElsewhere(false);
      replacePending(null);
      queryClient.removeQueries({ queryKey: holdsKeyKey });
      return refresh();
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

  const restore = useCallback(
    async (recoveryKeyText: string) => {
      if (!userId || !status.data) return;
      let rawKey: Uint8Array | undefined;
      try {
        rawKey = await parseRecoveryKey(recoveryKeyText);
        const controller = new AbortController();
        abortRef.current = controller;
        const empty = { processed: 0, restored: 0, skipped: 0, failed: 0 };
        setRestoreState({ status: 'running', progress: empty });
        const outcome = await restoreOnThisDevice(userId, rawKey, status.data, {
          signal: controller.signal,
          onProgress: (progress) => setRestoreState({ status: 'running', progress }),
        });
        if (outcome === 'wrong-key') {
          setRestoreState({ status: 'error', message: 'That key does not match this backup.' });
          return;
        }
        setRestoreState({ status: 'done', result: outcome });
        setDisabledElsewhere(false);
        queryClient.removeQueries({ queryKey: backupHoldsKeyKey(userId) });
        await queryClient.invalidateQueries({ queryKey: backupStatusKey(userId) });
      } catch (error) {
        const message = recoveryKeyMessage(
          error,
          "Couldn't finish restoring. Check your connection and try again.",
        );
        setRestoreState({ status: 'error', message });
      } finally {
        rawKey?.fill(0);
      }
    },
    [userId, status.data, queryClient],
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
    cancelRestore,
    resetRestore,
  };
}
