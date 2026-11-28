/**
 * Shared guards for user-typed information (names, addresses, free-text
 * item names). Names follow the manifest rule the add-passenger form has
 * always used — letters (any accent), spaces, hyphen, apostrophe — plus a
 * two-letter minimum. Addresses keep digits and the punctuation people
 * actually type (#, /, ., comma, hyphen) but reject emoji/symbols.
 */

/**
 * Shared guards for user-typed information (names, addresses, free-text
 * item names). Names follow the manifest rule the add-passenger form has
 * always used — letters (any accent), spaces, hyphen, apostrophe — plus a
 * two-letter minimum and a junk filter, because "www", "qqq" and "w-w"
 * were accepted as real people. Addresses keep digits and the punctuation
 * people actually type (#, /, ., comma, hyphen) but reject emoji/symbols.
 */

/** Letters (accents included), spaces, hyphen, apostrophe. */
const NAME_RE = /^[A-Za-zÀ-ÖØ-öø-ÿÑñ' -]+$/;
/** Printable address: letters, digits, spaces, , . # ( ) - / ' */
const ADDRESS_RE = /^[A-Za-z0-9À-ÖØ-öø-ÿÑñ' .,#()/-]+$/;
/** Item/description text: letters, digits, spaces, % & , . # ( ) - / ' */
const TEXT_RE = /^[A-Za-z0-9À-ÖØ-öø-ÿÑñ' .,#%&()/-]+$/;

/** null = valid. At least 2 letters, no digits/emoji/x, not keyboard junk. */
export function nameError(value: string): string | null {
  const v = value.trim();
  if (v.length < 2) return 'At least 2 letters';
  if (!NAME_RE.test(v)) return 'Letters, spaces, hyphens only';
  const letters = v.toLowerCase().replace(/[^a-zà-öø-ÿñ]/g, '');
  // Junk names: one letter repeated (www, qqq, oooooo) or a triple run.
  if (new Set(letters).size < 2) return 'Enter a real name';
  if (/([a-zà-öø-ÿñ])\1\1/.test(letters)) return 'Enter a real name';
  // "w-w" / "   www": no token is even two letters long. O'Brien and
  // "Maria Clara" still pass because at least one token is a real word.
  const tokens = v.split(/[\s\-']+/).filter(Boolean);
  if (tokens.every((t) => t.length < 2)) return 'Enter a real name';
  return null;
}

/** null = valid. Nothing that can't appear in a real address. */
export function addressError(value: string): string | null {
  const v = value.trim();
  if (v.length < 4) return 'Enter a complete address';
  if (!ADDRESS_RE.test(v)) return 'Letters, numbers and , . # - ( ) only';
  return null;
}

/** null = valid. For item names / short descriptions. */
export function textError(value: string): string | null {
  const v = value.trim();
  if (v.length < 2) return 'At least 2 characters';
  if (!TEXT_RE.test(v)) return 'Letters, numbers and basic punctuation only';
  return null;
}

/** Every boat in this fleet carries 10–25 passengers; the app offers it as a picker. */
export const MIN_CAPACITY = 10;
export const MAX_CAPACITY = 25;

/** null = valid. Boat capacity, in the 10–25 the app offers. */
export function capacityError(value: string | number): string | null {
  const n = Number(String(value).trim());
  if (!Number.isInteger(n) || n < MIN_CAPACITY || n > MAX_CAPACITY) {
    return `Capacity must be between ${MIN_CAPACITY} and ${MAX_CAPACITY}.`;
  }
  return null;
}

/**
 * Payout destination (095): a GCash mobile number. Stored one way —
 * 09XXXXXXXXX — so the payout call never has to guess between +63 and 0.
 */
export function normalizePayoutNumber(value: string): string {
  const compact = value.replace(/[^\d+]/g, '');
  return compact.startsWith('+63') ? `0${compact.slice(3)}` : compact;
}

/** null = valid. */
export function payoutNumberError(value: string): string | null {
  if (!/^09\d{9}$/.test(normalizePayoutNumber(value))) {
    return 'Enter a GCash number: 09XX XXX XXXX';
  }
  return null;
}
