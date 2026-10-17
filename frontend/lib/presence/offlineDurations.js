/** How long to appear offline, as the menu lists them and the API names them. */
export const OFFLINE_DURATIONS = [
  { value: "15m", label: "For 15 Minutes" },
  { value: "1h", label: "For 1 Hour" },
  { value: "8h", label: "For 8 Hours" },
  { value: "24h", label: "For 24 Hours" },
  { value: "3d", label: "For 3 Days" },
  { value: "forever", label: "Forever" },
];

const SAME_DAY_MS = 24 * 60 * 60 * 1000;

/** "until 3:40 PM", with the weekday when it is not within a day; "" when there is no end. */
export function describeUntil(until, now = Date.now()) {
  if (!until) return "";
  const end = new Date(until);
  const time = end.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (end.getTime() - now < SAME_DAY_MS && end.toDateString() === new Date(now).toDateString()) {
    return `until ${time}`;
  }
  return `until ${end.toLocaleDateString([], { weekday: "short" })} ${time}`;
}
