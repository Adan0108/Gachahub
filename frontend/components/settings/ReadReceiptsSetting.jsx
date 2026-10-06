"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCurrentUser } from "../../hooks/useCurrentUser";
import { api } from "../../lib/api";
import { queryKeys } from "../../lib/queries";

/** The on/off switch for read receipts; saved as soon as it is flipped, and put back if that fails. */
export function ReadReceiptsSetting() {
  const { user } = useCurrentUser();
  const queryClient = useQueryClient();
  const [error, setError] = useState("");
  const enabled = user?.sendReadReceipts !== false;

  const save = useMutation({
    mutationFn: (next) => api.updateProfile({ sendReadReceipts: next }),
    onMutate: async (next) => {
      setError("");
      await queryClient.cancelQueries({ queryKey: queryKeys.currentUser });
      const previous = queryClient.getQueryData(queryKeys.currentUser);
      queryClient.setQueryData(queryKeys.currentUser, (old) => old && { ...old, sendReadReceipts: next });
      return { previous };
    },
    onError: (failure, _next, context) => {
      queryClient.setQueryData(queryKeys.currentUser, context?.previous);
      setError("Couldn't save that. Try again.");
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.currentUser }),
  });

  return (
    <div className="settings-toggle-row">
      <label>
        <span>
          <b>Read receipts</b>
          <small>
            When this is on, people can see when you have read their messages, and you can see when they have read
            yours. Turn it off and neither works. &quot;Delivered&quot; still shows either way.
          </small>
        </span>
        <input
          aria-label="Read receipts"
          checked={enabled}
          disabled={!user}
          onChange={(event) => save.mutate(event.target.checked)}
          role="switch"
          type="checkbox"
        />
      </label>
      {error && (
        <small className="settings-toggle-error" role="alert">
          {error}
        </small>
      )}
    </div>
  );
}
