'use client';

import { useCallback, useState } from 'react';
import { assertSendable } from '../../lib/mls/media/prepareAttachments';

/** The composer's not-yet-sent files, dropped when the open conversation changes; a pick that could never be sent is refused with a message instead. */
export function useAttachmentPicker(conversationId: string) {
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState('');
  const [ownerId, setOwnerId] = useState(conversationId);

  // Reset during render so the old chat's files never paint in the new one.
  if (conversationId !== ownerId) {
    setOwnerId(conversationId);
    setFiles([]);
    setError('');
  }

  const add = useCallback(
    (picked: File[]) => {
      const next = [...files, ...picked];
      try {
        assertSendable(next);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Those files cannot be attached');
        return;
      }
      setError('');
      setFiles(next);
    },
    [files],
  );

  const remove = useCallback((index: number) => {
    setError('');
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const clear = useCallback(() => {
    setError('');
    setFiles([]);
  }, []);

  return { files, error, add, remove, clear };
}
