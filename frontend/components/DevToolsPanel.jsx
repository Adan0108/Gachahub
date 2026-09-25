"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FiCopy, FiLogIn, FiPlus, FiTool, FiTrash2, FiX } from "react-icons/fi";
import { api } from "../lib/api";

const DEV_TEST_USERS_KEY = ["dev-test-users"];

/**
 * Local dev-only test-user tooling - spawn a throwaway account, copy its id
 * to paste into chat's "New Chat" box, instantly sign in as it (no password
 * dance), or clean it up. Backend enforces the real boundary (these routes
 * only exist at all when NODE_ENV === 'development' - see backend's
 * app.module.ts) - this NODE_ENV check just keeps the panel itself, and the
 * fetch calls it would make, out of the production bundle entirely.
 */
export function DevToolsPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [copiedId, setCopiedId] = useState("");
  const queryClient = useQueryClient();

  const testUsers = useQuery({
    queryKey: DEV_TEST_USERS_KEY,
    queryFn: api.listDevTestUsers,
    enabled: isOpen,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: DEV_TEST_USERS_KEY });

  const spawn = useMutation({
    mutationFn: () => api.createDevTestUser(label.trim() || undefined),
    onSuccess: () => {
      setLabel("");
      invalidate();
    },
  });

  const impersonate = useMutation({
    mutationFn: (id) => api.impersonateDevTestUser(id),
    onSuccess: () => {
      window.location.href = "/";
    },
  });

  const remove = useMutation({
    mutationFn: (id) => api.deleteDevTestUser(id),
    onSuccess: invalidate,
  });

  const removeAll = useMutation({
    mutationFn: () => api.deleteAllDevTestUsers(),
    onSuccess: invalidate,
  });

  async function copyId(id) {
    try {
      await navigator.clipboard.writeText(id);
      setCopiedId(id);
      setTimeout(() => setCopiedId(""), 1500);
    } catch {
      // Clipboard API can be unavailable (insecure context, permissions) -
      // the id is still shown on-screen to copy by hand, so just no-op.
    }
  }

  const error = spawn.error || impersonate.error || remove.error || removeAll.error;

  return (
    <div className="dev-tools">
      <button
        aria-label={isOpen ? "Close dev tools" : "Open dev tools"}
        className="dev-tools-toggle"
        onClick={() => setIsOpen((current) => !current)}
        type="button"
      >
        {isOpen ? <FiX /> : <FiTool />}
      </button>

      {isOpen && (
        <div className="dev-tools-panel">
          <div className="dev-tools-head">
            <span>Dev tools</span>
            <small>test users only exist in development</small>
          </div>

          <form
            className="dev-tools-spawn"
            onSubmit={(event) => {
              event.preventDefault();
              if (spawn.isPending) return;
              spawn.mutate();
            }}
          >
            <input
              disabled={spawn.isPending}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="Label (optional), e.g. Bob"
              type="text"
              value={label}
            />
            <button disabled={spawn.isPending} type="submit">
              <FiPlus /> {spawn.isPending ? "Spawning..." : "Spawn"}
            </button>
          </form>

          {error && <small className="dev-tools-error">{error.message}</small>}

          <div className="dev-tools-list">
            {testUsers.isLoading && <small>Loading test users...</small>}
            {!testUsers.isLoading && testUsers.data?.length === 0 && (
              <small>No test users yet - spawn one above.</small>
            )}
            {testUsers.data?.map((user) => (
              <div className="dev-tools-user" key={user.id}>
                <div>
                  <b>{user.name}</b>
                  <span>{user.id}</span>
                </div>
                <div className="dev-tools-user-actions">
                  <button
                    aria-label="Copy user id"
                    onClick={() => copyId(user.id)}
                    title="Copy user id"
                    type="button"
                  >
                    <FiCopy /> {copiedId === user.id ? "Copied" : "Copy"}
                  </button>
                  <button
                    aria-label="Sign in as this user"
                    disabled={impersonate.isPending}
                    onClick={() => impersonate.mutate(user.id)}
                    title="Sign in as this user"
                    type="button"
                  >
                    <FiLogIn /> Sign in
                  </button>
                  <button
                    aria-label="Delete this test user"
                    className="danger"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(user.id)}
                    title="Delete this test user"
                    type="button"
                  >
                    <FiTrash2 />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {testUsers.data?.length > 0 && (
            <button
              className="dev-tools-clear"
              disabled={removeAll.isPending}
              onClick={() => {
                if (window.confirm(`Delete all ${testUsers.data.length} test user(s) and everything they own?`)) {
                  removeAll.mutate();
                }
              }}
              type="button"
            >
              <FiTrash2 /> Delete all test users
            </button>
          )}
        </div>
      )}
    </div>
  );
}
