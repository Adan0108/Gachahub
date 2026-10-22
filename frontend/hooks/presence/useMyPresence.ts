"use client";

import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { queries, queryKeys } from "../../lib/queries";
import { useCurrentUser } from "../useCurrentUser";

// Timers and pushes land within seconds of the end time, so an end this close counts as having run out.
const EXPIRY_GRACE_MS = 5_000;

/** Your own choice: online, or appearing offline until a time (or with no end). */
export function useMyPresence() {
  const { isAuthenticated } = useCurrentUser();
  const queryClient = useQueryClient();
  const query = useQuery({ ...queries.myPresence(), enabled: isAuthenticated });

  const change = useMutation({
    mutationFn: api.setMyPresence,
    onSuccess: (mine) => queryClient.setQueryData(queryKeys.myPresence, mine),
  });

  return { me: query.data, change };
}

/** Says so, once, when a timed offline choice runs out by itself; going online by hand stays quiet. */
type MyPresence = { status?: string; until?: string | null } | null | undefined;

export function useOfflineExpiryNotice(me: MyPresence, notify: (message: string) => void) {
  const previous = useRef<MyPresence>(undefined);

  useEffect(() => {
    const before = previous.current;
    previous.current = me;
    if (
      before?.status === "INVISIBLE" &&
      before.until &&
      me?.status === "ONLINE" &&
      Date.parse(before.until) <= Date.now() + EXPIRY_GRACE_MS
    ) {
      notify("You're visible again");
    }
  }, [me, notify]);
}
