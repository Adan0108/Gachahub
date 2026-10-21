"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { watchModerationSession } from "../lib/moderation";
import { useEffect, useState } from "react";

export function Providers({ children }) {
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

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
