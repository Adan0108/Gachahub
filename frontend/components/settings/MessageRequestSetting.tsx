"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCurrentUser } from "../../hooks/useCurrentUser";
import { api } from "../../lib/api";
import { queryKeys } from "../../lib/queries";

const OPTIONS = [
  { value: "EVERYONE", label: "Everyone", hint: "Anyone can send you a message request." },
  { value: "FOLLOWERS", label: "People you follow", hint: "Only people you follow can send you a request." },
  { value: "NO_ONE", label: "No one", hint: "Nobody can start a new chat with you. Existing chats keep working." },
] as const;

/** Who may send you a message request; saved as soon as one is picked, and put back if that fails. */
export function MessageRequestSetting() {
  const { user } = useCurrentUser();
  const queryClient = useQueryClient();
  const [error, setError] = useState("");
  const current = user?.messageRequestSetting ?? "EVERYONE";

  const save = useMutation({
    mutationFn: (next: string) => api.updateProfile({ messageRequestSetting: next }),
    onMutate: async (next) => {
      setError("");
      await queryClient.cancelQueries({ queryKey: queryKeys.currentUser });
      const previous = queryClient.getQueryData(queryKeys.currentUser);
      queryClient.setQueryData(queryKeys.currentUser, (old) => old && { ...old, messageRequestSetting: next });
      return { previous };
    },
    onError: (_failure, _next, context) => {
      queryClient.setQueryData(queryKeys.currentUser, context?.previous);
      setError("Couldn't save that. Try again.");
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.currentUser }),
  });

  return (
    <fieldset className="settings-toggle-row" disabled={!user}>
      <legend>
        <b>Who can send you message requests</b>
      </legend>
      {OPTIONS.map((option) => (
        <label key={option.value}>
          <span>
            <b>{option.label}</b>
            <small>{option.hint}</small>
          </span>
          <input
            checked={current === option.value}
            name="messageRequestSetting"
            onChange={() => save.mutate(option.value)}
            type="radio"
            value={option.value}
          />
        </label>
      ))}
      {error && (
        <small className="settings-toggle-error" role="alert">
          {error}
        </small>
      )}
    </fieldset>
  );
}
