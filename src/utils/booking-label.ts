import { slotLabel, todayIso } from '../components/SchedulePicker';
import type { BookingDoc } from '../types/models';

/** Padala modes as the crew reads them. */
const CARGO_MODE: Record<string, string> = {
  accompanied: 'ACCOMPANIED',
  piggyback: 'PIGGYBACK',
  batched: 'BATCHED',
  solo: 'SOLO',
};

/**
 * One line that says what was actually booked: padala mode, solo vs group,
 * charter, package, and which sailing (advance date + slot, or today's slot).
 * Both sides of the app describe a trip the same way.
 */
export function bookingTypeLabel(b: BookingDoc, pkgName?: string): string {
  const parts: string[] = [];
  if (b.serviceType === 'cargo') {
    parts.push(`PADALA · ${b.cargoMode ? CARGO_MODE[b.cargoMode] ?? b.cargoMode.toUpperCase() : 'CARGO'}`);
  } else if (b.serviceType === 'rental') {
    parts.push('BOAT RENTAL');
  } else {
    parts.push(b.numOfPassenger === 1 ? 'SOLO' : `GROUP · ${b.numOfPassenger} pax`);
  }

  if (b.packageId) {
    parts.push(`ISLAND HOPPING · ${pkgName ?? 'package'}`);
  } else if (b.scheduledDate) {
    const today = todayIso();
    if (b.scheduledDate > today) {
      const d = new Date(`${b.scheduledDate}T00:00:00`);
      parts.push(
        `ADVANCE · ${d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}` +
        `${b.scheduledTime ? ` ${slotLabel(b.scheduledTime)}` : ''}`
      );
    } else if (b.scheduledDate === today && b.scheduledTime) {
      // Sail day: the advance chip must not vanish on the morning it sails.
      parts.push(`TODAY · ${slotLabel(b.scheduledTime)}`);
    }
  }
  return parts.join(' · ');
}
