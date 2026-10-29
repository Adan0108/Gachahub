// Display side of the economy (docs/plans/economy-and-cosmetics.md). The backend owns every number that matters;
// these only label and draw what it returns.

export type RankId = "STARGAZER" | "METEOR" | "COMET" | "NOVA" | "SUPERNOVA" | "GALAXY";

export interface Wallet {
  reputation: number;
  shards: number;
  prisms: number;
  rank: RankId;
  reputation90d: number;
  today: { shardsEarned: number; shardCap: number; checkedIn: boolean; resetsAt: string };
}

export interface LedgerItem {
  id: string;
  currency: "REPUTATION" | "SHARDS" | "PRISMS";
  delta: number;
  balanceAfter: number;
  reason: string;
  createdAt: string;
}

/** Same thresholds as the backend's rankFor; Reputation earned in the last 90 days. */
export const RANKS: { id: RankId; name: string; from: number }[] = [
  { id: "STARGAZER", name: "Stargazer", from: 0 },
  { id: "METEOR", name: "Meteor", from: 100 },
  { id: "COMET", name: "Comet", from: 500 },
  { id: "NOVA", name: "Nova", from: 1_500 },
  { id: "SUPERNOVA", name: "Supernova", from: 4_000 },
  { id: "GALAXY", name: "Galaxy", from: 10_000 },
];

export function rankName(id: string | undefined): string {
  return RANKS.find((rank) => rank.id === id)?.name ?? "Stargazer";
}

/** How far into the current rank you are, and what the next one needs; `next` is null at the top. */
export function rankProgress(reputation90d: number, id: RankId) {
  const index = Math.max(
    0,
    RANKS.findIndex((rank) => rank.id === id),
  );
  const current = RANKS[index] ?? RANKS[0]!;
  const next = RANKS[index + 1] ?? null;
  if (!next) return { current, next, percent: 100, needed: 0 };
  const span = next.from - current.from;
  const into = Math.min(Math.max(reputation90d - current.from, 0), span);
  return {
    current,
    next,
    percent: Math.round((into / span) * 100),
    needed: Math.max(0, next.from - reputation90d),
  };
}

const REASON_LABELS: Record<string, string> = {
  DAILY_CHECKIN: "Daily check-in",
  LIKE_RECEIVED: "Like received",
  COMMENT_RECEIVED: "Comment received",
  LIKE_MILESTONE: "Like milestone",
  COMMENT_WRITTEN: "Comment written",
  REVOKED: "Taken back by moderation",
  RESTORED: "Given back",
  ADMIN_ADJUST: "Adjusted by an admin",
};

export function ledgerReasonLabel(reason: string): string {
  return REASON_LABELS[reason] ?? reason;
}

export const CURRENCY_LABELS: Record<LedgerItem["currency"], string> = {
  REPUTATION: "Reputation",
  SHARDS: "Shards",
  PRISMS: "Prisms",
};
