"use client";

import { useQuery } from "@tanstack/react-query";
import { queries } from "../../lib/queries";

/** The custom emotes this user can react with: app-wide ones plus those of the games they have joined. */
export function useEmotes({ enabled = true } = {}) {
  const query = useQuery({ ...queries.chatEmotes(), enabled });

  return { library: query.data, isLoading: query.isLoading };
}
