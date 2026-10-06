"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCurrentUser } from "../../hooks/useCurrentUser";
import { api } from "../../lib/api";
import { queryKeys } from "../../lib/queries";

/** An on/off switch for one yes/no field of the profile; saved as soon as it is flipped, and put back if that fails. */
export function ProfileToggleSetting({ field, label, description }) {
  const { user } = useCurrentUser();
  const queryClient = useQueryClient();
  const [error, setError] = useState("");
  // Anyone who never changed it has it on
  const enabled = user?.[field] !== false;

  const save = useMutation({
    mutationFn: (next) => api.updateProfile({ [field]: next }),
    onMutate: async (next) => {
      setError("");
      await queryClient.cancelQueries({ queryKey: queryKeys.currentUser });
      const previous = queryClient.getQueryData(queryKeys.currentUser);
      queryClient.setQueryData(queryKeys.currentUser, (old) => old && { ...old, [field]: next });
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
          <b>{label}</b>
          <small>{description}</small>
        </span>
        <input
          aria-label={label}
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
