export const DAY = 1000 * 60 * 60 * 24;

export function daysSince(iso: string, now = Date.now()): number {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return 0;
  return Math.max(0, (now - then) / DAY);
}

/** "2年3か月前" — the number that makes an unread pile feel like a pile. */
export function relativeAge(iso: string, now = Date.now()): string {
  const days = daysSince(iso, now);
  if (days < 1) return "今日";
  if (days < 30) return `${Math.floor(days)}日前`;

  const months = Math.floor(days / 30.44);
  if (months < 12) return `${months}か月前`;

  const years = Math.floor(months / 12);
  const rest = months % 12;
  return rest === 0 ? `${years}年前` : `${years}年${rest}か月前`;
}

export function yearMonth(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return `${date.getFullYear()}年${date.getMonth() + 1}月`;
}

export function compactCount(value: number): string {
  if (value < 1000) return String(value);
  if (value < 10_000) return `${(value / 1000).toFixed(1)}k`;
  return `${Math.round(value / 1000)}k`;
}
