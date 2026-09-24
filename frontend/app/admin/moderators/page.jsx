"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { FiAlertTriangle, FiPlus, FiTrash2, FiUserCheck, FiX } from "react-icons/fi";
import { AdminShell } from "../../../components/admin/AdminShell";
import { AdminState } from "../../../components/admin/AdminState";
import { useRequireAdmin } from "../../../hooks/useRequireAdmin";
import { useToast } from "../../../hooks/useToast";
import { api } from "../../../lib/api";
import { queries, queryKeys } from "../../../lib/queries";

function AssignmentForm({ game, onClose, onSaved }) {
  const [method, setMethod] = useState("email");
  const [target, setTarget] = useState("");
  const [error, setError] = useState("");
  const mutation = useMutation({
    mutationFn: () => api.assignGameModerator(game.slug, { [method]: target.trim() }),
    onSuccess: () => onSaved("Moderator assigned"),
    onError: (nextError) => setError(nextError.message || "Could not assign moderator"),
  });

  const submit = (event) => {
    event.preventDefault();
    if (!target.trim()) {
      setError(method === "email" ? "Enter the user's email address." : "Enter the user ID.");
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
          <fieldset className="admin-segmented admin-form-wide">
            <legend>Find user by</legend>
            <label>
              <input
                checked={method === "email"}
                name="method"
                onChange={() => {
                  setMethod("email");
                  setTarget("");
                  setError("");
                }}
                type="radio"
              />
              <span>Email</span>
            </label>
            <label>
              <input
                checked={method === "userId"}
                name="method"
                onChange={() => {
                  setMethod("userId");
                  setTarget("");
                  setError("");
                }}
                type="radio"
              />
              <span>User ID</span>
            </label>
          </fieldset>
          <label className="admin-form-wide">
            <span>{method === "email" ? "User email" : "User ID"} *</span>
            <input
              autoFocus
              name="target"
              onChange={(event) => {
                setTarget(event.target.value);
                setError("");
              }}
              placeholder={method === "email" ? "moderator@example.com" : "User database ID"}
              type={method === "email" ? "email" : "text"}
              value={target}
            />
          </label>
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

function RemovalDialog({ assignment, game, onClose, onRemoved }) {
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
  const session = useRequireAdmin();
  const queryClient = useQueryClient();
  const { notice, showNotice } = useToast(2400);
  const [gameSlug, setGameSlug] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [removing, setRemoving] = useState(null);
  const games = useQuery({ ...queries.adminGames("", ""), enabled: session.isAdmin });
  const selectedGameSlug = gameSlug || games.data?.items?.[0]?.slug || "";
  const moderators = useQuery({
    ...queries.adminModerators(selectedGameSlug),
    enabled: session.isAdmin && Boolean(selectedGameSlug),
  });

  if (session.isLoading || !session.isAdmin)
    return <AdminState kind="loading" title="Checking admin access" />;

  const selectedGame = games.data?.items?.find((game) => game.slug === selectedGameSlug);
  const assignments = Array.isArray(moderators.data)
    ? moderators.data
    : moderators.data?.items || [];
  const refresh = async (message) => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.adminModerators(selectedGameSlug) });
    setAssigning(false);
    setRemoving(null);
    showNotice(message);
  };

  return (
    <AdminShell user={session.user}>
      <div className="admin-page-heading">
        <div>
          <span className="admin-eyebrow">Permissions</span>
          <h1>Game moderators</h1>
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
                {games.data.items.map((game) => (
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
          {moderators.isLoading || !selectedGameSlug ? (
            <AdminState
              kind="loading"
              title="Loading moderators"
              message="Retrieving scoped assignments."
            />
          ) : moderators.isError ? (
            <AdminState
              kind="error"
              title="Moderators unavailable"
              message={moderators.error?.message || "Assignments could not be loaded."}
              onRetry={() => moderators.refetch()}
            />
          ) : !assignments.length ? (
            <AdminState
              kind="empty"
              title="No moderators assigned"
              message={`Assign the first moderator for ${selectedGame?.name || "this community"}.`}
            />
          ) : (
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
                      <th>
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {assignments.map((assignment) => (
                      <tr key={assignment.id || assignment.user.id}>
                        <td>
                          <div className="admin-user-cell">
                            <span>{assignment.user.name?.charAt(0)?.toUpperCase() || "M"}</span>
                            <b>{assignment.user.name || "Unnamed user"}</b>
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
          )}
        </>
      )}
      {assigning && selectedGame ? (
        <AssignmentForm game={selectedGame} onClose={() => setAssigning(false)} onSaved={refresh} />
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
