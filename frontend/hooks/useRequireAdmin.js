"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useCurrentUser } from "./useCurrentUser";

const ADMIN_PREVIEW = process.env.NEXT_PUBLIC_ADMIN_PREVIEW === "true";
const previewUser = {
  id: "admin-preview",
  name: "Admin Preview",
  email: "preview@localhost",
  role: "ADMIN",
  status: "ACTIVE",
};

export function useRequireAdmin() {
  const router = useRouter();
  const session = useCurrentUser({ enabled: !ADMIN_PREVIEW });
  const isAdmin = session.user?.role === "ADMIN";

  useEffect(() => {
    if (ADMIN_PREVIEW) return;
    if (session.isLoading) return;
    if (!session.isAuthenticated) router.replace("/login");
    else if (!isAdmin) router.replace("/");
  }, [isAdmin, router, session.isAuthenticated, session.isLoading]);

  if (ADMIN_PREVIEW) {
    return {
      user: previewUser,
      isAuthenticated: true,
      isLoading: false,
      isError: false,
      isAdmin: true,
      refetch: session.refetch,
    };
  }

  return { ...session, isAdmin };
}
