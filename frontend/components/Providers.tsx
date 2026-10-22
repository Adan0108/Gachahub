"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { watchModerationSession } from "../lib/moderation";
import { PostDeleteNotice } from "./PostDeleteNotice";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  );

  useEffect(() => watchModerationSession(queryClient), [queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <PostDeleteNotice />
    </QueryClientProvider>
  );
}
