"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { canEditMessage } from "../../lib/chat/editPolicy";
import { MAX_EDIT_TEXT_CHARS } from "../../lib/mls/messaging/editEnvelope";

interface EditRequest {
  messageId: string;
  text: string;
  n: number;
  clientId: string;
}
export interface PendingEdit {
  text: string;
  n: number;
  clientId: string;
  failed: boolean;
  error?: string;
}
interface EditTarget {
  id: string;
  text: string;
  previousDraft: string;
}
interface EditOptions<Response> {
  draft: string;
  setDraft: (text: string) => void;
  edited: Map<string, { versions: readonly unknown[] }>;
  messagesById: Map<string, { createdAt: string }>;
  send: (edit: EditRequest) => Promise<Response>;
  onSent: (response: Response) => void;
  focusInput?: () => void;
}

/**
 * Editing one of your own messages from the composer. Saving is optimistic: the composer is free
 * at once and the message shows the new text as `pending` until the server has it; a failed save
 * stays on the message (`failed`) to retry or discard.
 *
 * The composer's draft is borrowed while editing and put back afterwards.
 * `send({ messageId, text, n, clientId })` stores the edit; `onSent(response)` runs after it did.
 */
export function useMessageEdit<Response>({
  draft,
  setDraft,
  edited,
  messagesById,
  send,
  onSent,
  focusInput,
}: EditOptions<Response>) {
  const [target, setTarget] = useState<EditTarget | null>(null);
  const [error, setError] = useState("");
  // Edits sent and not yet confirmed, by message id: { text, n, clientId, failed, error }.
  const [pending, setPending] = useState(() => new Map<string, PendingEdit>());

  const setPendingEntry = (messageId: string, entry: PendingEdit | null) =>
    setPending((current) => {
      const next = new Map(current);
      if (entry) next.set(messageId, entry);
      else next.delete(messageId);
      return next;
    });

  /** Leaves edit mode; the borrowed draft goes back unless the caller restores it somewhere else (a switch to another conversation). */
  const leave = ({ restoreDraft = true } = {}) => {
    if (restoreDraft) setDraft(target?.previousDraft ?? "");
    setTarget(null);
    setError("");
  };

  const save = useMutation({
    mutationFn: send,
    onSuccess: (response, variables) => {
      onSent(response);
      // After the cache listeners have run, so the old text never shows for a frame in between.
      setTimeout(() => setPendingEntry(variables.messageId, null), 0);
    },
    onError: (failure, variables) =>
      setPendingEntry(variables.messageId, {
        text: variables.text,
        n: variables.n,
        clientId: variables.clientId,
        failed: true,
        error: failure.message || "Couldn't save your edit.",
      }),
  });

  const start = ({ id, text }: { id: string; text: string }) => {
    setError("");
    setTarget((current) => ({ id, text, previousDraft: current?.previousDraft ?? draft }));
    setDraft(text);
    focusInput?.();
  };

  const submit = () => {
    if (!target) return;
    const text = draft.trim();
    // Nothing changed: just leave edit mode.
    if (!text || text === target.text.trim()) return leave();
    if (text.length > MAX_EDIT_TEXT_CHARS) {
      return setError(`Edits can be up to ${MAX_EDIT_TEXT_CHARS} characters.`);
    }

    const versions = edited.get(target.id)?.versions;
    const allowed = canEditMessage({
      mine: true,
      isText: true,
      sentAt: Date.parse(messagesById.get(target.id)?.createdAt ?? ""),
      now: Date.now(),
      editCount: versions ? versions.length - 1 : 0,
    });
    // Checked here too, since an edit that is refused still uses up an encryption step.
    if (!allowed) return setError("This message can't be edited any more.");

    const edit = {
      messageId: target.id,
      text,
      n: versions ? versions.length : 1,
      clientId: crypto.randomUUID(),
    };
    setPendingEntry(edit.messageId, { text, n: edit.n, clientId: edit.clientId, failed: false });
    leave();
    save.mutate(edit);
  };

  /** Tries a failed edit again; the same clientMessageId means the server never applies it twice. */
  const retry = (messageId: string) => {
    const entry = pending.get(messageId);
    if (!entry) return;
    setPendingEntry(messageId, { ...entry, failed: false });
    save.mutate({ messageId, text: entry.text, n: entry.n, clientId: entry.clientId });
  };

  /** Gives up on a failed edit; the message goes back to what it said. */
  const discard = (messageId: string) => setPendingEntry(messageId, null);

  return { target, error, pending, start, submit, leave, retry, discard };
}
