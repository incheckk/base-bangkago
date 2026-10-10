/** Today in Manila (UTC+8) as YYYY-MM-DD — the schedule's reference day. */
export function manilaTodayIso(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
}

/** Manila calendar day (YYYY-MM-DD) for a timestamp, null when unknown. */
export function toManilaIso(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
}

/** Epoch ms of a Manila day's start. Manila has no DST so +08:00 is exact. */
export function manilaDayStartMs(dayIso: string): number {
  return new Date(`${dayIso}T00:00:00+08:00`).getTime();
}
