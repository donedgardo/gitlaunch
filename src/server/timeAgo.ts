// Compact "how long ago" label for build report times, e.g. "18m ago",
// "2h ago", "3d ago". Pure so it can be unit-tested against a fixed `now`;
// the Handlebars `timeAgo` helper wraps this with the real clock.
const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

export function formatTimeAgo(
  from: Date | string | null | undefined,
  now: Date,
): string {
  if (!from) return "";
  const then = from instanceof Date ? from : new Date(from);
  if (Number.isNaN(then.getTime())) return "";

  const seconds = Math.floor((now.getTime() - then.getTime()) / 1000);
  if (seconds < MINUTE) return "just now";
  if (seconds < HOUR) return `${Math.floor(seconds / MINUTE)}m ago`;
  if (seconds < DAY) return `${Math.floor(seconds / HOUR)}h ago`;
  if (seconds < MONTH) return `${Math.floor(seconds / DAY)}d ago`;
  if (seconds < YEAR) return `${Math.floor(seconds / MONTH)}mo ago`;
  return `${Math.floor(seconds / YEAR)}y ago`;
}
