"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { FiArrowRight, FiAtSign, FiUser } from "react-icons/fi";
import { useRequireAuth } from "../../hooks/useRequireAuth";
import { useSignOut } from "../../hooks/useSignOut";
import { api } from "../../lib/api";
import { queryKeys } from "../../lib/queries";
import { USERNAME_HINT, USERNAME_PATTERN, canClaimHandle } from "../../lib/username";

const AVAILABILITY_DEBOUNCE_MS = 400;

export default function OnboardingPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const session = useRequireAuth();
  // null = not yet touched - falls back to whatever name they already typed at signup,
  // so picking a handle doesn't also force retyping a name they're happy with.
  const [name, setName] = useState(null);
  const [username, setUsername] = useState("");
  const [error, setError] = useState("");
  // Keyed by the username it was computed for, so a result for a now-superseded handle is never read as current.
  const [availabilityResult, setAvailabilityResult] = useState({
    forUsername: "",
    status: "idle",
  });

  const displayName = name ?? session.user?.name ?? "";
  const usernameFormatValid = USERNAME_PATTERN.test(username);
  const availability =
    availabilityResult.forUsername === username ? availabilityResult.status : "idle";
  // Availability is advisory, not authoritative (the DB unique index is); only a known-taken handle blocks submit.
  const canSubmit = displayName.trim().length >= 2 && usernameFormatValid && availability !== "taken";

  // Keyed on the handle, not `onboarded`: a backfilled account isn't forced here but may still claim.
  useEffect(() => {
    if (!session.isLoading && session.user && !canClaimHandle(session.user)) router.replace("/");
  }, [router, session.isLoading, session.user]);

  // Debounced live availability check - no point calling the backend on every keystroke.
  useEffect(() => {
    if (!usernameFormatValid) return undefined;

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      if (cancelled) return;
      setAvailabilityResult({ forUsername: username, status: "checking" });
      try {
        const result = await api.checkUsernameAvailable(username);
        if (!cancelled) {
          setAvailabilityResult({
            forUsername: username,
            status: result.available ? "available" : "taken",
          });
        }
      } catch {
        if (!cancelled) setAvailabilityResult({ forUsername: username, status: "idle" });
      }
    }, AVAILABILITY_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [username, usernameFormatValid]);

  const complete = useMutation({
    mutationFn: () => api.completeOnboarding({ name: displayName.trim(), username }),
    // Writes the server's own response straight into the cache instead of invalidating and
    // refetching - a refetch racing the redirect below could still read the pre-onboarding
    // snapshot when AppShell's gate re-checks it, bouncing straight back to /onboarding.
    onSuccess: (updatedUser) => {
      queryClient.setQueryData(queryKeys.currentUser, (previous) => ({
        ...previous,
        ...updatedUser,
      }));
      router.replace("/");
    },
    onError: (nextError) => setError(nextError.message || "Could not save your profile"),
  });

  // This page is a mandatory interstitial - it needs its own exit.
  const signOut = useSignOut();

  const submit = (event) => {
    event.preventDefault();
    if (!canSubmit || complete.isPending) return;
    setError("");
    complete.mutate();
  };

  if (session.isLoading || !session.isAuthenticated) {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <p>Loading...</p>
        </section>
      </main>
    );
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="auth-card-header">
          <Link href="/" className="auth-brand">
            <span>✦</span>
            GachaHub
          </Link>
        </div>
        <h1>Set up your profile.</h1>
        <p>Pick the name and handle other players will see you by.</p>

        <form className="auth-form" onSubmit={submit}>
          <label>
            Display name
            <span>
              <FiUser />
              <input
                autoFocus
                maxLength={50}
                onChange={(event) => {
                  setName(event.target.value);
                  setError("");
                }}
                placeholder="Hertzy"
                value={displayName}
              />
            </span>
          </label>
          <label>
            Handle
            <span>
              <FiAtSign />
              <input
                maxLength={20}
                onChange={(event) => {
                  setUsername(event.target.value.trim());
                  setError("");
                }}
                placeholder="Hertzy-123"
                value={username}
              />
            </span>
          </label>
          {username.length > 0 && !usernameFormatValid && (
            <p className="auth-field-hint" role="alert">
              {USERNAME_HINT}
            </p>
          )}
          {usernameFormatValid && availability === "checking" && (
            <p className="auth-field-hint" aria-live="polite">
              Checking availability...
            </p>
          )}
          {usernameFormatValid && availability === "available" && (
            <p className="auth-field-hint available" aria-live="polite">
              @{username} is available.
            </p>
          )}
          {usernameFormatValid && availability === "taken" && (
            <p className="auth-field-hint taken" role="alert">
              @{username} is already taken.
            </p>
          )}

          {error && (
            <div className="auth-message error" role="alert">
              {error}
            </div>
          )}

          <button
            className="primary auth-submit"
            disabled={!canSubmit || complete.isPending}
            type="submit"
          >
            {complete.isPending ? "Saving..." : "Continue"}
            <FiArrowRight />
          </button>
        </form>

        <button
          className="auth-switch onboarding-signout"
          disabled={signOut.isPending}
          onClick={() => signOut.mutate()}
          type="button"
        >
          {signOut.isPending ? "Signing out..." : "Sign out instead"}
        </button>
      </section>
    </main>
  );
}
