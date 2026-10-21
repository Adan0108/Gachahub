"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ModeratorPicker } from "../moderation/ModeratorPicker";
import { AdminActionDialog } from "./AdminActionDialog";
import { api } from "../../lib/api";
import { moderationKeys, moderatorRoleLabel } from "../../lib/moderation";
import { AvatarFace } from "../AvatarFace";
import { useToast } from "../../hooks/useToast";

export function PlatformModeratorManagement({ actorId }) {
  const [target, setTarget] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [generation, setGeneration] = useState(0);
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
      await Promise.all([
        client.invalidateQueries({ queryKey: moderationKeys.all }),
        client.invalidateQueries({ queryKey: ["admin", "overview"] }),
        client.invalidateQueries({ queryKey: ["admin", "users"] }),
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
            className="admin-button admin-button-primary"
            type="button"
            onClick={() => setConfirming(true)}
          >
            {revoke ? "Revoke Platform moderator" : "Grant Platform moderator"}
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
          error={
            change.isError
              ? change.error?.message || "Could not update access. Search again and retry."
              : ""
          }
          onClose={() => {
            setConfirming(false);
            change.reset();
          }}
          onConfirm={() => change.mutate()}
        />
      )}
      {notice && (
        <div className="toast" role="status">
          {notice}
        </div>
      )}
    </section>
  );
}
