"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useCurrentUser } from "./useCurrentUser";

export function useRequireAuth() {
  const router = useRouter();
  const session = useCurrentUser();

  useEffect(() => {
    if (!session.isLoading && !session.isAuthenticated) router.replace("/login");
  }, [router, session.isAuthenticated, session.isLoading]);

  return session;
}
