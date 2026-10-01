"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useState } from "react";
import { FiEdit2, FiList, FiPlus, FiSearch, FiX } from "react-icons/fi";
import { AdminShell } from "../../../components/admin/AdminShell";
import { AdminState } from "../../../components/admin/AdminState";
import { useRequireAdmin } from "../../../hooks/useRequireAdmin";
import { useToast } from "../../../hooks/useToast";
import { api } from "../../../lib/api";
import { queries, queryKeys } from "../../../lib/queries";

const emptyForm = {
  name: "",
  slug: "",
  description: "",
  iconUrl: "",
  bannerUrl: "",
  developer: "",
  publisher: "",
  status: "ACTIVE",
};

function formFromGame(game) {
  const source = game?.raw || game || {};
  return {
    name: source.name || "",
    slug: source.slug || "",
    description: source.description || "",
    iconUrl: source.iconUrl || "",
    bannerUrl: source.bannerUrl || "",
    developer: source.developer || "",
    publisher: source.publisher || "",
    status: source.status || "ACTIVE",
  };
}

function cleanPayload(form, editing) {
  const payload = Object.fromEntries(
    Object.entries(form).filter(([, value]) => typeof value !== "string" || value.trim()),
  );
  if (!editing) delete payload.status;
  return payload;
}

function CommunityForm({ game, onClose, onSaved }) {
  const editing = Boolean(game);
  const [form, setForm] = useState(() => (editing ? formFromGame(game) : emptyForm));
  const [error, setError] = useState("");
  const mutation = useMutation({
    mutationFn: (payload) => (editing ? api.updateGame(game.id, payload) : api.createGame(payload)),
    onSuccess: () => onSaved(editing ? "Community updated" : "Community created"),
    onError: (nextError) => setError(nextError.message || "Could not save community"),
  });

  const updateField = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
    setError("");
  };

  const submit = (event) => {
    event.preventDefault();
    if (form.name.trim().length < 2) {
      setError("Community name must contain at least 2 characters.");
      return;
    }
    mutation.mutate(cleanPayload(form, editing));
  };

  return (
    <div
      className="admin-dialog-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        aria-labelledby="community-form-title"
        aria-modal="true"
        className="admin-dialog"
        role="dialog"
      >
        <div className="admin-dialog-heading">
          <div>
            <span className="admin-eyebrow">{editing ? "Edit record" : "New record"}</span>
            <h2 id="community-form-title">{editing ? "Update community" : "Create community"}</h2>
          </div>
          <button aria-label="Close" onClick={onClose} type="button">
            <FiX />
          </button>
        </div>
        <form className="admin-form" onSubmit={submit}>
          <label>
            <span>Name *</span>
            <input
              autoFocus
              maxLength={100}
              name="name"
              onChange={updateField}
              required
              value={form.name}
            />
          </label>
          <label>
            <span>Slug</span>
            <input
              maxLength={120}
              name="slug"
              onChange={updateField}
              placeholder="Generated from name when blank"
              value={form.slug}
            />
          </label>
          <label className="admin-form-wide">
            <span>Description</span>
            <textarea
              maxLength={1000}
              name="description"
              onChange={updateField}
              rows={4}
              value={form.description}
            />
          </label>
          <label>
            <span>Developer</span>
            <input maxLength={100} name="developer" onChange={updateField} value={form.developer} />
          </label>
          <label>
            <span>Publisher</span>
            <input maxLength={100} name="publisher" onChange={updateField} value={form.publisher} />
          </label>
          <label className="admin-form-wide">
            <span>Icon URL</span>
            <input
              name="iconUrl"
              onChange={updateField}
              placeholder="https://"
              type="url"
              value={form.iconUrl}
            />
          </label>
          <label className="admin-form-wide">
            <span>Banner URL</span>
            <input
              name="bannerUrl"
              onChange={updateField}
              placeholder="https://"
              type="url"
              value={form.bannerUrl}
            />
          </label>
          {editing ? (
            <label>
              <span>Status</span>
              <select name="status" onChange={updateField} value={form.status}>
                <option value="ACTIVE">Active</option>
                <option value="HIDDEN">Hidden</option>
                <option value="ARCHIVED">Archived</option>
              </select>
            </label>
          ) : null}
          {error ? (
            <p className="admin-form-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="admin-form-actions">
            <button className="admin-button admin-button-secondary" onClick={onClose} type="button">
              Cancel
            </button>
            <button
              className="admin-button admin-button-primary"
              disabled={mutation.isPending}
              type="submit"
            >
              {mutation.isPending ? "Saving..." : editing ? "Save changes" : "Create community"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

export default function AdminCommunitiesPage() {
  const session = useRequireAdmin();
  const queryClient = useQueryClient();
  const { notice, showNotice } = useToast(2400);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [selectedGame, setSelectedGame] = useState(undefined);
  const games = useQuery({ ...queries.adminGames(search, status), enabled: session.isAdmin });

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const closeForm = () => setSelectedGame(undefined);
  const handleSaved = async (message) => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.adminGames(search, status) });
    closeForm();
    showNotice(message);
  };

  if (session.isLoading || !session.isAdmin)
    return <AdminState kind="loading" title="Checking admin access" />;

  const items = games.data?.items || [];

  return (
    <AdminShell user={session.user}>
      <div className="admin-page-heading">
        <div>
          <span className="admin-eyebrow">Communities</span>
          <h1>Game management</h1>
          <p>Create official communities and maintain their public metadata.</p>
        </div>
        <button
          className="admin-button admin-button-primary"
          onClick={() => setSelectedGame(null)}
          type="button"
        >
          <FiPlus /> New community
        </button>
      </div>
      <section className="admin-toolbar" aria-label="Community filters">
        <label className="admin-search">
          <FiSearch aria-hidden="true" />
          <input
            aria-label="Search communities"
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search name or slug"
            value={searchInput}
          />
        </label>
        <select
          aria-label="Filter by status"
          onChange={(event) => setStatus(event.target.value)}
          value={status}
        >
          <option value="">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="HIDDEN">Hidden</option>
          <option value="ARCHIVED">Archived</option>
        </select>
        <span>{games.data?.meta?.total ?? 0} communities</span>
      </section>
      {games.isLoading ? (
        <AdminState
          kind="loading"
          title="Loading communities"
          message="Retrieving community records."
        />
      ) : games.isError ? (
        <AdminState
          kind="error"
          title="Communities unavailable"
          message={games.error?.message || "The game list could not be loaded."}
          onRetry={() => games.refetch()}
        />
      ) : !items.length ? (
        <AdminState
          kind="empty"
          title="No communities found"
          message={
            search || status
              ? "Try changing the current search or status filter."
              : "Create the first official game community."
          }
        />
      ) : (
        <section className="admin-panel">
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Community</th>
                  <th>Slug</th>
                  <th>Developer</th>
                  <th>Members</th>
                  <th>Status</th>
                  <th className="admin-actions-heading">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((game) => (
                  <tr key={game.id}>
                    <td>
                      <div className="admin-community-cell">
                        <span>
                          {game.iconUrl ? <img alt="" src={game.iconUrl} /> : game.symbol}
                        </span>
                        <div>
                          <b>{game.name}</b>
                          <small>{game.description || "No description"}</small>
                        </div>
                      </div>
                    </td>
                    <td>
                      <code>{game.slug}</code>
                    </td>
                    <td>{game.developer || "—"}</td>
                    <td>{game.members}</td>
                    <td>
                      <span
                        className={`admin-status admin-status-${(game.status || "ACTIVE").toLowerCase()}`}
                      >
                        {game.status || "ACTIVE"}
                      </span>
                    </td>
                    <td>
                      <Link
                        aria-label={`Manage categories for ${game.name}`}
                        className="admin-icon-button"
                        href={`/admin/communities/${encodeURIComponent(game.slug)}/categories`}
                      >
                        <FiList />
                      </Link>
                      <button
                        aria-label={`Edit ${game.name}`}
                        className="admin-icon-button"
                        onClick={() => setSelectedGame(game)}
                        type="button"
                      >
                        <FiEdit2 />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {selectedGame !== undefined ? (
        <CommunityForm game={selectedGame} onClose={closeForm} onSaved={handleSaved} />
      ) : null}
      {notice ? (
        <div className="toast admin-toast" role="status">
          {notice}
        </div>
      ) : null}
    </AdminShell>
  );
}
