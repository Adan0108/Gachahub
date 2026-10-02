"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { FiFlag } from "react-icons/fi";
import { AdminActionDialog } from "../../components/admin/AdminActionDialog";
import { AdminQueryBoundary } from "../../components/admin/AdminQueryBoundary";
import { GameBrandingUploader } from "../../components/admin/GameBrandingUploader";
import { useRequireModerator } from "../../hooks/admin/useRequireModerator";
import { useToast } from "../../hooks/useToast";
import { api } from "../../lib/api";
import { queryKeys } from "../../lib/queries";

export default function ModeratorPage() {
  const session = useRequireModerator();
  const queryClient = useQueryClient();
  const { notice, showNotice } = useToast(2400);
  const [flaggingGame, setFlaggingGame] = useState(null);
  const [reason, setReason] = useState("");

  const invalidateGames = () => queryClient.invalidateQueries({ queryKey: queryKeys.moderatedGames });

  const flagMutation = useMutation({
    mutationFn: () => api.flagGameForReview(flaggingGame.slug, reason.trim() || undefined),
    onSuccess: () => {
      showNotice("Flagged for admin review");
      setFlaggingGame(null);
      setReason("");
    },
  });

  return (
    <div className="page moderator-page">
      <div className="admin-page-heading">
        <div>
          <span className="admin-eyebrow">Moderator</span>
          <h1>My games</h1>
          <p>Update branding for the communities you moderate, or flag one for admin review.</p>
        </div>
      </div>
      <AdminQueryBoundary
        empty={
          !session.games.length
            ? {
                title: "No games assigned",
                message: "An admin hasn't assigned you to moderate a game yet.",
              }
            : null
        }
        error={{ title: "Couldn't load your games", message: "Try reloading the page." }}
        isError={session.gamesError}
        isLoading={session.isLoading}
        onRetry={session.refetchGames}
        loading={{ title: "Checking moderator access" }}
      >
        <div className="moderator-game-grid">
          {session.games.map((game) => {
            const archived = game.status === "ARCHIVED";
            return (
              <section className="admin-panel moderator-game-card" key={game.id}>
                <div className="moderator-game-heading">
                  <h2>{game.name}</h2>
                  {archived ? <span className="admin-status admin-status-archived">ARCHIVED</span> : null}
                </div>
                {archived ? (
                  <p className="moderator-game-archived-note">
                    This game is archived - branding and flagging are unavailable until an admin restores
                    it.
                  </p>
                ) : (
                  <>
                    <div className="moderator-game-branding">
                      <GameBrandingUploader
                        currentUrl={game.iconUrl}
                        gameSlug={game.slug}
                        label="Icon"
                        onUpdated={invalidateGames}
                        purpose="GAME_ICON"
                      />
                      <GameBrandingUploader
                        currentUrl={game.bannerUrl}
                        gameSlug={game.slug}
                        label="Banner"
                        onUpdated={invalidateGames}
                        purpose="GAME_BANNER"
                      />
                    </div>
                    <button
                      className="admin-button admin-button-secondary"
                      onClick={() => {
                        setFlaggingGame(game);
                        setReason("");
                      }}
                      type="button"
                    >
                      <FiFlag /> Flag for review
                    </button>
                  </>
                )}
              </section>
            );
          })}
        </div>
      </AdminQueryBoundary>
      {flaggingGame ? (
        <AdminActionDialog
          confirmLabel="Flag for review"
          description="An admin will see this on the Overview dashboard's activity feed. This does not change the game's status."
          error={flagMutation.error?.message}
          onClose={() => setFlaggingGame(null)}
          onConfirm={() => flagMutation.mutate()}
          pending={flagMutation.isPending}
          pendingLabel="Flagging..."
          title={`Flag ${flaggingGame.name}?`}
          tone="primary"
        >
          <div className="admin-dialog-fields">
            <label>
              <span>Reason (optional)</span>
              <textarea
                maxLength={500}
                onChange={(event) => setReason(event.target.value)}
                placeholder="What should the admin look at?"
                rows={3}
                value={reason}
              />
            </label>
          </div>
        </AdminActionDialog>
      ) : null}
      {notice ? (
        <div className="toast admin-toast" role="status">
          {notice}
        </div>
      ) : null}
    </div>
  );
}
