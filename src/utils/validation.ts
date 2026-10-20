/**
 * Shared guards for user-typed information (names, addresses, free-text
 * item names). Names follow the manifest rule the add-passenger form has
 * always used — letters (any accent), spaces, hyphen, apostrophe — plus a
 * two-letter minimum. Addresses keep digits and the punctuation people
 * actually type (#, /, ., comma, hyphen) but reject emoji/symbols.
 */

/** Letters (accents included), spaces, hyphen, apostrophe. */
const NAME_RE = /^[A-Za-zÀ-ÖØ-öø-ÿÑñ' -]+$/;
/** Printable address: letters, digits, spaces, , . # ( ) - / ' */
const ADDRESS_RE = /^[A-Za-z0-9À-ÖØ-öø-ÿÑñ' .,#()/-]+$/;
/** Item/description text: letters, digits, spaces, % & , . # ( ) - / ' */
const TEXT_RE = /^[A-Za-z0-9À-ÖØ-öø-ÿÑñ' .,#%&()/-]+$/;

/** null = valid. At least 2 letters, no digits/emoji/symbols. */
export function nameError(value: string): string | null {
  const v = value.trim();
  if (v.length < 2) return 'At least 2 letters';
  if (!NAME_RE.test(v)) return 'Letters, spaces, hyphens only';
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
