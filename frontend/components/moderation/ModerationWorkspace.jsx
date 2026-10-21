"use client";
import { AdminShell } from "../admin/AdminShell";

import Link from "next/link";
import { AdminState } from "../admin/AdminState";
import { FiShield } from "react-icons/fi";
import { casePath } from "../../lib/moderation";

export function ModerationWorkspace({ access, gameSlug = "", children }) {
  if (access.isLoading)
    return (
      <section className="page moderation-workspace">
        <AdminState kind="loading" title="Checking moderation access" />
      </section>
    );
  if (access.error)
    return (
      <section className="page moderation-workspace">
        <AdminState
          kind="error"
          title="Access could not be verified"
          message={access.error.message}
          onRetry={access.retry}
        />
      </section>
    );
  if (!access.allowed)
    return (
      <section className="page moderation-workspace">
        <AdminState
          kind="error"
          title="Moderation access required"
          message={
            access.isAuthenticated
              ? "This workspace is not available for your account."
              : "Sign in with an authorized account."
          }
        />
        <Link href={access.isAuthenticated ? "/" : "/login"}>
          {access.isAuthenticated ? "Return home" : "Sign in"}
        </Link>
      </section>
    );
  const content = (
    <section className="page moderation-workspace">
      <div className="moderation-bar">
        <span className="moderation-brand">
          <FiShield aria-hidden="true" /> Safety workspace
        </span>
        <nav className="moderation-navigation" aria-label="Case workspace navigation">
          <Link href={casePath(gameSlug)}>{gameSlug ? "Community cases" : "All cases"}</Link>
          {access.privileged && gameSlug && <Link href="/moderation/cases">All cases</Link>}
          {!access.privileged && <Link href="/moderator">My communities</Link>}
          {access.user.role === "ADMIN" && <Link href="/admin">Admin console</Link>}
        </nav>
      </div>
      {children}
    </section>
  );
  return access.privileged ? <AdminShell user={access.user} moderation>{content}</AdminShell> : content;
}
