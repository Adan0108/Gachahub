import type { DiscordLogSource } from '../discord/discord-logger.service';

/**
 * One data invariant: a statement about the database that should never be
 * false, no matter which code path ran. Domains register theirs with the
 * IntegrityCheckRegistry; the IntegrityService sweeps them on a schedule and
 * alerts when one is violated. This catches what the error logger cannot: an
 * operation that succeeded (nothing thrown, nothing logged) but left the data
 * wrong, or rows changed by no code at all.
 */
export interface IntegrityCheck {
  /** Short kebab-case id; part of the alert's dedup key. */
  name: string;
  /** One sentence for the alert title: the thing that should never be true. */
  title: string;
  /** Which Discord banner the alert goes out under. */
  source: DiscordLogSource;
  /** Sampled descriptions of violating rows; empty means healthy. */
  findViolations(): Promise<string[]>;
}
