/**
 * Philippine mobile numbers, normalized to E.164 for storage and to a synthetic
 * email for Firebase Auth. Bangkeros type their number a dozen different ways;
 * every one of them has to land on the same account.
 */

const AUTH_EMAIL_DOMAIN = 'bangkago.app';

/**
 * Accepts any of: 0917 123 4567 · 0917-123-4567 · (0917) 1234567 · 9171234567
 * · +63 917 123 4567 · 639171234567 · 0063 917 123 4567
 * Returns E.164 (+639XXXXXXXXX), or null if it is not a valid PH mobile number.
 */
export function normalizePhone(raw: string): string | null {
  if (!raw) return null;

  // Strip everything that isn't a digit — the leading "+" carries no information
  // once we anchor on the 0063 / 63 / 0 prefixes below.
  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;

  let local: string;
  if (digits.startsWith('0063')) local = digits.slice(4);
  else if (digits.startsWith('63')) local = digits.slice(2);
  else if (digits.startsWith('0')) local = digits.slice(1);
  else local = digits;

  // PH mobile subscriber numbers are exactly 10 digits and always start with 9.
  if (local.length !== 10 || !local.startsWith('9')) return null;

  return `+63${local}`;
}

/**
 * +639171234567 -> 639171234567@bangkago.app
 * Firebase Phone Auth needs reCAPTCHA or a native build, neither of which works
 * in Expo Go — so the phone number *is* the account, carried on a synthetic email.
 */
export function phoneToAuthEmail(phone: string): string {
  const e164 = normalizePhone(phone);
  if (!e164) throw new Error(`phoneToAuthEmail: not a valid PH mobile number: ${phone}`);
  return `${e164.slice(1)}@${AUTH_EMAIL_DOMAIN}`;
}

/** +639171234567 -> "0917 123 4567" for display. Falls back to the input. */
export function formatPhone(phone: string): string {
  const e164 = normalizePhone(phone);
  if (!e164) return phone;
  const local = e164.slice(3); // drop "+63"
  return `0${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6)}`;
}
