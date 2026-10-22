/** 75 -> "1:15", 3725 -> "1:02:05"; anything that is not a usable time reads as 0:00. */
export function formatClock(seconds: number): string {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = String(total % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}

/** A position on the bar, kept between the start and the end of the video. */
export function clampTime(seconds: number, duration: number): number {
  const end = Number.isFinite(duration) && duration > 0 ? duration : 0;
  return Math.min(Math.max(Number.isFinite(seconds) ? seconds : 0, 0), end);
}
