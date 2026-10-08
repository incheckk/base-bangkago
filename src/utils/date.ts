/** Today in Manila (UTC+8) as YYYY-MM-DD — the schedule's reference day. */
export function manilaTodayIso(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
}
