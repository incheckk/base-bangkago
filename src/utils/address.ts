import { REGION7_CITIES, type PhCity } from '../data/region7';

/**
 * Pure address helpers behind the passenger info pickers, kept out of the
 * component so they can be unit-tested. The address stays ONE string in
 * `passenger_details.address` (028) — no migration.
 */

/** "City of Lapu-Lapu" reads like a database row; people say "Lapu-Lapu City". */
export function cityLabel(name: string): string {
  return name.startsWith('City of ') ? `${name.slice(8)} City` : name;
}

/**
 * Carmen, Pilar and Valencia each sit in two Region VII provinces, so the
 * plain label is not unique: two rows in one list, and the first one always
 * won. Only those names get the province; nothing else changes.
 */
const DUPLICATE_CITY_LABELS = new Set(
  REGION7_CITIES.map((c) => cityLabel(c.name))
    .filter((label, i, all) => all.indexOf(label) !== i),
);

export function cityOptionLabel(city: PhCity): string {
  const label = cityLabel(city.name);
  return DUPLICATE_CITY_LABELS.has(label) ? `${label} (${city.province})` : label;
}

/**
 * The city a saved address points at. Matches whole comma-separated segments
 * only — "12 Mabini St." must not be read as the municipality of Mabini.
 * The exact option label wins so "Carmen (Cebu)" stays Cebu; the plain
 * label is the legacy fallback (and maps to the same city as before).
 */
export function addressCity(value: string): PhCity | null {
  const parts = value.split(',').map((s) => s.trim());
  return (
    REGION7_CITIES.find((c) => parts.includes(cityOptionLabel(c))) ??
    REGION7_CITIES.find((c) => parts.includes(cityLabel(c.name))) ??
    null
  );
}

export function composeAddress(street: string, barangay: string, city: string): string {
  return [street.trim(), barangay, city, 'Region VII'].filter(Boolean).join(', ');
}

/** Pull a previously saved address back into the three picker states. */
export function parseAddress(value: string): { street: string; city: string; barangay: string } {
  const city = addressCity(value);
  if (!city) return { street: value.trim(), city: '', barangay: '' };
  const option = cityOptionLabel(city);
  const label = cityLabel(city.name);
  const parts = value.split(',').map((s) => s.trim()).filter(Boolean);
  const barangay = parts.find((p) => city.barangays.includes(p)) ?? '';
  const street = parts
    .filter(
      (p) =>
        p !== barangay &&
        p !== option &&
        p !== label &&
        p !== city.name &&
        p !== 'Region VII' &&
        p !== 'Central Visayas',
    )
    .join(', ');
  return { street, city: option, barangay };
}
