"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useCurrentUser } from "./useCurrentUser";

export function useRequireAdmin() {
  const router = useRouter();
  const session = useCurrentUser();
  const isAdmin = session.user?.role === "ADMIN";

  useEffect(() => {
    if (session.isLoading) return;
    if (!session.isAuthenticated) router.replace("/login");
    else if (!isAdmin) router.replace("/");
  }, [isAdmin, router, session.isAuthenticated, session.isLoading]);

  return { ...session, isAdmin };
}
