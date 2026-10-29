"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FiAward, FiCheck, FiHexagon, FiLock } from "react-icons/fi";
import { QueryNotice } from "../../components/QueryNotice";
import { useCurrentUser } from "../../hooks/useCurrentUser";
import { useToast } from "../../hooks/useToast";
import { api } from "../../lib/api";
import {
  CURRENCY_LABELS,
  ledgerReasonLabel,
  rankProgress,
  type LedgerItem,
  type Wallet,
} from "../../lib/economy";
import { queries, queryKeys } from "../../lib/queries";

function hoursUntil(iso: string) {
  const hours = Math.max(0, Math.ceil((Date.parse(iso) - Date.now()) / 3_600_000));
  return hours <= 1 ? "within the hour" : `in ${hours}h`;
}

export default function WalletPage() {
  const { isAuthenticated, isLoading: isSessionLoading } = useCurrentUser();
  const queryClient = useQueryClient();
  const { notice, showNotice } = useToast();
  const wallet = useQuery({ ...queries.wallet(), enabled: isAuthenticated });
  const ledger = useQuery({ ...queries.walletLedger(), enabled: isAuthenticated });
  const checkIn = useMutation({
    mutationFn: () => api.checkIn() as Promise<{ shards: number }>,
    onSuccess: (result) =>
      showNotice(
        result.shards > 0
          ? `+${result.shards} Shards`
          : "Checked in (today's Shard cap is already reached)",
      ),
    onError: (error: Error) => showNotice(error.message),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.wallet }),
  });

  if (!isSessionLoading && !isAuthenticated) {
    return (
      <div className="page wallet-page">
        <div className="wallet-card">
          <p>
            <Link href="/login">Log in</Link> to see your wallet.
          </p>
        </div>
      </div>
    );
  }

  const data = wallet.data as Wallet | undefined;
  const items = ((ledger.data as { items?: LedgerItem[] } | undefined)?.items ?? []) as LedgerItem[];
  const progress = data ? rankProgress(data.reputation90d, data.rank) : null;

  return (
    <div className="page wallet-page">
      <div className="toast-slot" aria-live="polite">
        {notice}
      </div>
      <h1>Wallet</h1>
      <QueryNotice isLoading={wallet.isLoading} isError={wallet.isError} />

      {data && progress && (
        <>
          <section className="wallet-card wallet-rank" aria-label="Rank">
            <div className="wallet-rank-head">
              <FiAward aria-hidden="true" />
              <div>
                <b>{progress.current.name}</b>
                <small>{data.reputation.toLocaleString()} Reputation all time</small>
              </div>
            </div>
            <div
              aria-label={`${progress.percent}% of the way to ${progress.next?.name ?? "the top"}`}
              aria-valuemax={100}
              aria-valuemin={0}
              aria-valuenow={progress.percent}
              className="wallet-progress"
              role="progressbar"
            >
              <i style={{ width: `${progress.percent}%` }} />
            </div>
            <small>
              {progress.next
                ? `${data.reputation90d.toLocaleString()} in the last 90 days · ${progress.needed.toLocaleString()} more for ${progress.next.name}`
                : `${data.reputation90d.toLocaleString()} in the last 90 days · top rank`}
            </small>
          </section>

          <div className="wallet-balances">
            <section className="wallet-card" aria-label="Shards">
              <span className="wallet-currency">
                <FiHexagon aria-hidden="true" /> Shards
              </span>
              <b className="wallet-amount">{data.shards.toLocaleString()}</b>
              <small>
                Today {data.today.shardsEarned}/{data.today.shardCap} · resets{" "}
                {hoursUntil(data.today.resetsAt)}
              </small>
              <button
                className="primary"
                disabled={data.today.checkedIn || checkIn.isPending}
                onClick={() => checkIn.mutate()}
                type="button"
              >
                {data.today.checkedIn ? (
                  <>
                    <FiCheck aria-hidden="true" /> Checked in today
                  </>
                ) : (
                  "Daily check-in"
                )}
              </button>
            </section>
            <section className="wallet-card" aria-label="Prisms">
              <span className="wallet-currency">
                <FiLock aria-hidden="true" /> Prisms
              </span>
              <b className="wallet-amount">{data.prisms.toLocaleString()}</b>
              <small>Come with Gachahub+ (coming soon)</small>
            </section>
          </div>
        </>
      )}

      <section className="wallet-card" aria-label="History">
        <h2>History</h2>
        <QueryNotice isLoading={ledger.isLoading} isError={ledger.isError} />
        {!ledger.isLoading && items.length === 0 && (
          <small>Nothing yet. Likes and comments on your posts earn Reputation and Shards.</small>
        )}
        <ul className="wallet-ledger">
          {items.map((item) => (
            <li key={item.id}>
              <span>
                <b>{ledgerReasonLabel(item.reason)}</b>
                <small>{new Date(item.createdAt).toLocaleString()}</small>
              </span>
              <span className={item.delta < 0 ? "wallet-delta negative" : "wallet-delta"}>
                {item.delta > 0 ? "+" : ""}
                {item.delta} {CURRENCY_LABELS[item.currency]}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
