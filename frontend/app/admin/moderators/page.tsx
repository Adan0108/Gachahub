"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { Suspense, useState } from "react";
import type { FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import type { GameRecord, ModeratorAssignment } from "../../../lib/pageTypes";
import { FiAlertTriangle, FiPlus, FiTrash2, FiUserCheck, FiX } from "react-icons/fi";
import {
  ModeratorPicker,
  type ModeratorCandidate,
} from "../../../components/moderation/ModeratorPicker";
import { AvatarFace } from "../../../components/AvatarFace";
import { PlatformModeratorManagement } from "../../../components/admin/PlatformModeratorManagement";
import { AdminQueryBoundary } from "../../../components/admin/AdminQueryBoundary";
import { AdminShell } from "../../../components/admin/AdminShell";
import { AdminState } from "../../../components/admin/AdminState";
import { useAdminList } from "../../../hooks/admin/useAdminList";
import { useRequireAdmin } from "../../../hooks/admin/useRequireAdmin";
import { useToast } from "../../../hooks/useToast";
import { api } from "../../../lib/api";
import { queries, queryKeys } from "../../../lib/queries";

function PlatformModeratorsWithSearch({ actorId }: { actorId?: string }) {
  const params = useSearchParams();
  const search = params?.get("search")?.slice(0, 100) || "";
  return <PlatformModeratorManagement key={search} actorId={actorId} initialSearch={search} />;
}


function AssignmentForm({
  game,
  actorId,
  onClose,
  onSaved,
}: {
  game: GameRecord;
  actorId?: string;
  onClose: () => void;
  onSaved: (message: string) => unknown;
}) {
  const [target, setTarget] = useState<ModeratorCandidate | null>(null);
  const [error, setError] = useState("");
  const mutation = useMutation({
    mutationFn: () => api.assignGameModerator(game.slug, { userId: target?.id }),
    onSuccess: () => onSaved("Moderator assigned"),
    onError: (nextError) => setError(nextError.message || "Could not assign moderator"),
  });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!target) {
      setError("Choose a moderator from the search results.");
      return;
    }
    mutation.mutate();
  };

  return (
    <div
      className="admin-dialog-backdrop"
      onMouseDown={(event) =>
        event.target === event.currentTarget && !mutation.isPending && onClose()
      }
    >
      <section
        aria-labelledby="assignment-title"
        aria-modal="true"
        className="admin-dialog admin-dialog-compact"
        role="dialog"
      >
        <div className="admin-dialog-heading">
          <div>
            <span className="admin-eyebrow">Scoped access</span>
            <h2 id="assignment-title">Assign moderator</h2>
            <p>{game.name}</p>
          </div>
          <button aria-label="Close" disabled={mutation.isPending} onClick={onClose} type="button">
            <FiX />
          </button>
        </div>
        <form className="admin-form" onSubmit={submit}>
          <ModeratorPicker
            actorId={actorId}
            scopeKey={`grant:${game.slug}`}
            game={game}
            granting
            search={(q: string, options: { signal: AbortSignal }) =>
              api.searchGameModeratorCandidates(game.slug, q, options)
            }
            onSelect={(user: ModeratorCandidate) => {
              setTarget(user);
              setError("");
            }}
            disabled={mutation.isPending}
          />
          {target && (
            <p role="status">
              Selected {target.name}
              {target.username ? ` (@${target.username})` : ""}
            </p>
          )}
          <p className="admin-form-note admin-form-wide">
            This grants moderation permission only within {game.name}. It does not change the user's
            platform role.
          </p>
          {error ? (
            <p className="admin-form-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="admin-form-actions">
            <button
              className="admin-button admin-button-secondary"
              disabled={mutation.isPending}
              onClick={onClose}
              type="button"
            >
              Cancel
            </button>
            <button
              className="admin-button admin-button-primary"
              disabled={mutation.isPending}
              type="submit"
            >
              {mutation.isPending ? "Assigning..." : "Assign moderator"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function RemovalDialog({
  assignment,
  game,
  onClose,
  onRemoved,
}: {
  assignment: ModeratorAssignment;
  game: GameRecord;
  onClose: () => void;
  onRemoved: (message: string) => unknown;
}) {
  const mutation = useMutation({
    mutationFn: () => api.removeGameModerator(game.slug, assignment.user.id),
    onSuccess: () => onRemoved("Moderator removed"),
  });

  return (
    <div className="admin-dialog-backdrop">
      <section
        aria-labelledby="removal-title"
        aria-modal="true"
        className="admin-dialog admin-confirm-dialog"
        role="alertdialog"
      >
        <div className="admin-confirm-icon">
          <FiAlertTriangle />
        </div>
        <h2 id="removal-title">Remove moderator access?</h2>
        <p>
          <b>{assignment.user.name || assignment.user.email}</b> will no longer be able to moderate{" "}
          {game.name}.
        </p>
        {mutation.isError ? (
          <p className="admin-form-error" role="alert">
            {mutation.error?.message || "Could not remove moderator"}
          </p>
        ) : null}
        <div className="admin-form-actions">
          <button
            className="admin-button admin-button-secondary"
            disabled={mutation.isPending}
            onClick={onClose}
            type="button"
          >
            Keep moderator
          </button>
          <button
            className="admin-button admin-button-danger"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate()}
            type="button"
          >
            {mutation.isPending ? "Removing..." : "Remove access"}
          </button>
        </div>
      </section>
    </div>
  );
}

export default function AdminModeratorsPage() {
  const { notice, showNotice } = useToast(2400);
  const [gameSlug, setGameSlug] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [removing, setRemoving] = useState<ModeratorAssignment | null>(null);
  const session = useRequireAdmin();
  const games = useQuery({ ...queries.adminGames("", ""), enabled: session.isAdmin });
  const selectedGameSlug = gameSlug || games.data?.items?.[0]?.slug || "";
  const {
    items: assignments,
    invalidate,
    query: moderators,
  } = useAdminList<ModeratorAssignment>(() => queries.adminModerators(selectedGameSlug), {
    prefix: queryKeys.adminModerators.all(selectedGameSlug),
  });

  if (session.isLoading || !session.isAdmin)
    return <AdminState kind="loading" title="Checking admin access" />;

  const selectedGame = games.data?.items?.find(
    (game: GameRecord) => game.slug === selectedGameSlug,
  );
  const refresh = async (message: string) => {
    await invalidate();
    setAssigning(false);
    setRemoving(null);
    showNotice(message);
  };

  return (
    <AdminShell user={session.user}>
      <div className="admin-page-heading">
        <div>
          <span className="admin-eyebrow">Permissions</span>
          <h1>Moderators</h1>
          <p>Manage platform access and separate game assignments.</p>
        </div>
      </div>
      <Suspense fallback={<AdminState kind="loading" title="Loading platform moderators" />}>
        <PlatformModeratorsWithSearch actorId={session.user.id} />
      </Suspense>
      <div className="admin-page-heading">
        <div>
          <span className="admin-eyebrow">Permissions</span>
          <h2>Game moderators</h2>
          <p>Assign and revoke moderation access for individual communities.</p>
        </div>
        <button
          className="admin-button admin-button-primary"
          disabled={!selectedGame}
          onClick={() => setAssigning(true)}
          type="button"
        >
          <FiPlus /> Assign moderator
        </button>
      </div>
      {games.isLoading ? (
        <AdminState kind="loading" title="Loading communities" />
      ) : games.isError ? (
        <AdminState
          kind="error"
          title="Communities unavailable"
          message={games.error?.message}
          onRetry={() => games.refetch()}
        />
      ) : !games.data?.items?.length ? (
        <AdminState
          kind="empty"
          title="No communities available"
          message="Create a community before assigning moderators."
        />
      ) : (
        <>
          <section className="admin-scope-picker">
            <label>
              <span>Community scope</span>
              <select
                onChange={(event) => {
                  setGameSlug(event.target.value);
                  setRemoving(null);
                }}
                value={selectedGameSlug}
              >
                {games.data.items.map((game: GameRecord) => (
                  <option key={game.id} value={game.slug}>
                    {game.name}
                  </option>
                ))}
              </select>
            </label>
            <p>
              <FiUserCheck /> Moderator permissions apply only to the selected game.
            </p>
          </section>
          <AdminQueryBoundary
            query={moderators}
            loading={{ title: "Loading moderators", message: "Retrieving scoped assignments." }}
            error={{
              title: "Moderators unavailable",
              message: moderators.error?.message || "Assignments could not be loaded.",
            }}
            empty={
              !assignments.length
                ? {
                    title: "No moderators assigned",
                    message: `Assign the first moderator for ${selectedGame?.name || "this community"}.`,
                  }
                : null
            }
          >
            <section className="admin-panel">
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Moderator</th>
                      <th>Email</th>
                      <th>User status</th>
                      <th>Assigned by</th>
                      <th>Assigned</th>
                      <th className="admin-actions-heading">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assignments.map((assignment) => (
                      <tr key={assignment.id || assignment.user.id}>
                        <td>
                          <div className="admin-user-cell">
                            <span className="case-person-avatar">
                              <AvatarFace
                                name={assignment.user.name}
                                image={assignment.user.image}
                              />
                            </span>
                            <div>
                              <b>{assignment.user.name || "Unnamed user"}</b>
                              {assignment.user.username && (
                                <small>@{assignment.user.username}</small>
                              )}
                              <small>
                                Game moderator for {selectedGame?.name || "this community"}
                              </small>
                            </div>
                          </div>
                        </td>
                        <td>{assignment.user.email}</td>
                        <td>
                          <span
                            className={`admin-status ${assignment.user.status === "ACTIVE" ? "" : "admin-status-archived"}`}
                          >
                            {assignment.user.status}
                          </span>
                        </td>
                        <td>
                          {assignment.assigner?.name ||
                            assignment.assigner?.email ||
                            "Administrator"}
                        </td>
                        <td>
                          {assignment.createdAt
                            ? new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(
                                new Date(assignment.createdAt),
                              )
                            : "—"}
                        </td>
                        <td>
                          <button
                            aria-label={`Remove ${assignment.user.name || assignment.user.email}`}
                            className="admin-icon-button admin-icon-danger"
                            onClick={() => setRemoving(assignment)}
                            type="button"
                          >
                            <FiTrash2 />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </AdminQueryBoundary>
        </>
      )}
      {assigning && selectedGame ? (
        <AssignmentForm
          actorId={session.user?.id}
          game={selectedGame}
          onClose={() => setAssigning(false)}
          onSaved={refresh}
        />
      ) : null}
      {removing && selectedGame ? (
        <RemovalDialog
          assignment={removing}
          game={selectedGame}
          onClose={() => setRemoving(null)}
          onRemoved={refresh}
        />
      ) : null}
      {notice ? (
        <div className="toast admin-toast" role="status">
          {notice}
        </div>
      ) : null}
    </AdminShell>
  );
}
