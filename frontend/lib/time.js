/** Shared, pure time-formatting helpers - used by chat and the admin dashboard alike. */

export function relativeTime(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.valueOf())) return "Recently";
  // Clamped at 0, not floored straight to hours - anything under an hour old used to always read
  // "1h ago" regardless of whether it was 1 minute or 59 minutes old.
  const minutes = Math.max(0, Math.floor((Date.now() - date.valueOf()) / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
}
