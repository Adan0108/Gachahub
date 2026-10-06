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

/** "Just now", "5m", "3h", "2d", "1w" - the short form for a list row, where the time sits right beside the message. */
export function compactRelativeTime(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.valueOf())) return "";

  const minutes = Math.max(0, Math.floor((Date.now() - date.valueOf()) / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return days < 7 ? `${days}d` : `${Math.floor(days / 7)}w`;
}

/** How long ago for the past week ("5m", "2d"), then the date ("Oct 3", "Oct 3, 2025" from another year). */
export function messageDateLabel(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.valueOf())) return "";

  const days = (Date.now() - date.valueOf()) / 86_400_000;
  if (days < 7) return compactRelativeTime(value);

  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}
