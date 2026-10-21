"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ModeratorPicker } from "../moderation/ModeratorPicker";
import { AdminActionDialog } from "./AdminActionDialog";
import { api } from "../../lib/api";
import { moderationKeys, moderatorRoleLabel } from "../../lib/moderation";
import { AvatarFace } from "../AvatarFace";
import { useToast } from "../../hooks/useToast";
import { AdminPagination } from "./AdminPagination";
import { AdminQueryBoundary } from "./AdminQueryBoundary";
import { moderationError } from "../../lib/moderation";

export function PlatformModeratorManagement({ actorId, initialSearch = "" }) {
  const [target, setTarget] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [page, setPage] = useState(1);
  const list = useQuery({
    queryKey: ["admin", "platform-moderators", actorId, page],
    queryFn: ({ signal }) =>
      api.listAdminUsers({ role: "PLATFORM_MODERATOR", page, limit: 20 }, { signal }),
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });
  const client = useQueryClient();
  const { notice, showNotice } = useToast(3500);
  const revoke = target?.role === "PLATFORM_MODERATOR";
  const change = useMutation({
    mutationFn: () =>
      revoke ? api.revokePlatformModerator(target.id) : api.grantPlatformModerator(target.id),
    onSuccess: async () => {
      setConfirming(false);
      setTarget(null);
      setGeneration((value) => value + 1);
      setPage(1);
      await Promise.all([
        client.invalidateQueries({ queryKey: moderationKeys.all }),
        client.invalidateQueries({ queryKey: ["admin", "overview"] }),
        client.invalidateQueries({ queryKey: ["admin", "users"] }),
        client.invalidateQueries({ queryKey: ["admin", "platform-moderators"] }),
      ]);
      showNotice(
        revoke
          ? "Platform moderator access removed. Normal user access remains."
          : "Platform moderator access granted.",
      );
    },
  });
  return (
    <section className="admin-panel platform-moderator-management" aria-label="Platform moderators">
      <h2>Platform moderators</h2>
      <p>
        Search an active user to grant platform-wide moderation access, or find a platform moderator
        to remove it. Game assignments stay separate.
      </p>
      <ModeratorPicker
        initialQuery={initialSearch}
        label="Find user or platform moderator"
        key={generation}
        actorId={actorId}
        scopeKey={`platform-privilege:${generation}`}
        granting
        search={(q, options) => api.searchPlatformModeratorCandidates(q, options)}
        onSelect={(user) => {
          setTarget(user);
          change.reset();
        }}
        disabled={change.isPending || confirming}
      />
      {target && (
        <div className="platform-moderator-selection">
          <span className="case-person-avatar" aria-hidden="true">
            <AvatarFace name={target.name} image={target.image} />
          </span>
          <div>
            <b>{target.name}</b>
            {target.username && <span> @{target.username}</span>}
            <small className="case-role-badge">
              {target.role === "USER" ? "User" : moderatorRoleLabel(target)}
            </small>
          </div>
          <button
            className={`admin-button admin-button-${revoke ? "danger" : "primary"}`}
            type="button"
            onClick={() => setConfirming(true)}
          >
            {revoke ? "Remove platform moderator access" : "Grant platform moderator access"}
          </button>
        </div>
      )}
      {confirming && (
        <AdminActionDialog
          title={revoke ? "Remove platform moderator access?" : "Grant platform moderator access?"}
          description={
            revoke
              ? `${target.name} will lose platform-wide moderation access. Normal user access and any game moderator assignments remain.`
              : `${target.name} will be able to review cases across GachaHub. Existing game moderator assignments remain.`
          }
          confirmLabel={revoke ? "Remove platform access" : "Grant platform access"}
          pendingLabel="Updating access..."
          tone={revoke ? "danger" : "primary"}
          pending={change.isPending}
          error={change.isError ? moderationError(change.error) : ""}
          onClose={() => {
            setConfirming(false);
            change.reset();
          }}
          onConfirm={() => change.mutate()}
        />
      )}
      <AdminQueryBoundary
        query={list}
        loading={{ title: "Loading platform moderators" }}
        error={{ title: "Platform moderators unavailable", message: moderationError(list.error) }}
        empty={
          !list.data?.items?.length
            ? {
                title: "No platform moderators",
                message: "Use the identity search above to grant access.",
              }
            : null
        }
      >
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Moderator</th>
                <th>Status</th>
                <th>Role</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {(list.data?.items || []).map((user) => (
                <tr key={user.id}>
                  <td>
                    <div className="admin-user-cell">
                      <span className="case-person-avatar">
                        <AvatarFace name={user.name} image={user.image} />
                      </span>
                      <div>
                        <b>{user.name}</b>
                        {user.username && <small>@{user.username}</small>}
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className="admin-status">
                      {{
                        ACTIVE: "Active",
                        BANNED: "Banned",
                        SUSPENDED: "Suspended",
                        DELETED: "Deleted",
                      }[user.status] || "Unavailable"}
                    </span>
                  </td>
                  <td>
                    <span className="case-role-badge">Platform moderator</span>
                  </td>
                  <td>
                    <button
                      className="admin-button admin-button-danger"
                      type="button"
                      disabled={user.status !== "ACTIVE" || change.isPending}
                      title={
                        user.status !== "ACTIVE"
                          ? "Only active accounts can change moderator access"
                          : undefined
                      }
                      onClick={() => {
                        change.reset();
                        setTarget(user);
                        setConfirming(true);
                      }}
                    >
                      Remove access
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <AdminPagination
          page={page}
          totalPages={list.data?.meta?.totalPages ?? 1}
          onChange={setPage}
        />
      </AdminQueryBoundary>
      {notice && (
        <div className="toast" role="status">
          {notice}
        </div>
      )}
    </section>
  );
}
