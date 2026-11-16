import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

import type { BookerDetails } from './booking.service';
import type { BookingDoc, PassengerDetailDoc } from '../types/models';
import { formatPhone } from '../utils/phone';

export interface ManifestPdfEntry {
  booking: BookingDoc;
  companions: PassengerDetailDoc[];
  booker?: BookerDetails | null;
}

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function tripDate(booking: BookingDoc): string {
  if (booking.scheduledDate) {
    return booking.scheduledTime
      ? `${booking.scheduledDate} ${booking.scheduledTime}`
      : booking.scheduledDate;
  }
  const date = new Date(booking.createdAt);
  if (Number.isNaN(date.getTime())) return booking.createdAt;
  return date.toLocaleString('en-PH', { timeZone: 'Asia/Manila' });
}

function passengerRow(
  name: string,
  contact: string | null | undefined,
  age: number | null | undefined,
  type: string,
  address: string | null | undefined,
  boardedAt: string | null | undefined,
  isBooker = false
): string {
  return `
    <tr>
      <td>${esc(name)}${isBooker ? ' <span class="tag">Booker</span>' : ''}</td>
      <td>${esc(contact || '-')}</td>
      <td>${age == null ? '-' : esc(age)}</td>
      <td>${esc(type)}</td>
      <td>${esc(address || 'Not on file')}</td>
      <td>${boardedAt ? 'Yes' : 'No'}</td>
    </tr>`;
}

function bookingSection(entry: ManifestPdfEntry): string {
  const { booking, companions, booker } = entry;
  const bookerName = booking.passengerName || 'Unknown';
  const paxLabel = booking.serviceType === 'cargo' ? 'Parcels' : 'Pax count';
  const rows = [
    passengerRow(
      bookerName,
      booking.passengerPhone,
      booker?.age,
      'Booker',
      booker?.address,
      booking.onboardedAt,
      true
    ),
    ...companions.map((companion) =>
      passengerRow(
        `${companion.firstName} ${companion.lastName}`.trim() || 'Unknown',
        companion.contactNumber,
        companion.age,
        companion.passengerType,
        companion.address,
        companion.boardedAt
      )
    ),
  ].join('');

  return `
    <section class="booking">
      <div class="booking-head">
        <div>
          <div class="eyebrow">Booking reference</div>
          <h2>${esc(booking.ref)}</h2>
        </div>
        <span class="status">${esc(booking.status)}</span>
      </div>

      <div class="grid">
        <div><span>Booker</span><strong>${esc(bookerName)}</strong></div>
        <div><span>Contact</span><strong>${esc(formatPhone(booking.passengerPhone || '') || '-')}</strong></div>
        <div><span>Route</span><strong>${esc(booking.fromPortName || '-')} to ${esc(booking.toPortName || '-')}</strong></div>
        <div><span>Date</span><strong>${esc(tripDate(booking))}</strong></div>
        <div><span>${esc(paxLabel)}</span><strong>${esc(booking.numOfPassenger)}</strong></div>
        <div><span>Operator</span><strong>${esc(booking.operatorName || 'Unassigned')}</strong></div>
        <div><span>Boat</span><strong>${esc(booking.operatorBoatName || 'Unassigned')}</strong></div>
        <div><span>Fare</span><strong>PHP ${esc(booking.totalPrice)}</strong></div>
      </div>

      <h3>Passenger list (${companions.length + 1})</h3>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Contact</th>
            <th>Age</th>
            <th>Type</th>
            <th>Address</th>
            <th>Boarded</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </section>`;
}

function buildHtml(entries: ManifestPdfEntry[]): string {
  const generated = new Date().toLocaleString('en-PH', { timeZone: 'Asia/Manila' });
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    @page { margin: 24px; }
    * { box-sizing: border-box; }
    body { font-family: Helvetica, Arial, sans-serif; color: #172a42; margin: 0; font-size: 11px; }
    header { background: #172a42; color: #ffffff; padding: 18px 20px; border-radius: 8px; margin-bottom: 18px; }
    header h1 { margin: 0; font-size: 22px; }
    header p { margin: 5px 0 0; color: #cfe8ee; font-size: 11px; }
    .booking { border: 1px solid #d9e3ea; border-radius: 8px; padding: 14px; margin-bottom: 16px; page-break-inside: avoid; }
    .booking-head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1px solid #e6edf2; padding-bottom: 10px; margin-bottom: 10px; }
    .eyebrow { color: #5f7883; font-size: 9px; text-transform: uppercase; letter-spacing: 0.8px; }
    h2 { margin: 2px 0 0; font-size: 18px; }
    h3 { margin: 16px 0 6px; font-size: 12px; color: #172a42; }
    .status { background: #e6f7f2; color: #0f766e; border-radius: 999px; padding: 4px 9px; font-size: 9px; font-weight: bold; text-transform: uppercase; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 18px; }
    .grid div { border-bottom: 1px solid #f0f4f7; padding-bottom: 4px; }
    .grid span { display: block; color: #6b7f89; font-size: 9px; font-weight: bold; text-transform: uppercase; }
    .grid strong { display: block; margin-top: 2px; font-size: 11px; }
    table { width: 100%; border-collapse: collapse; margin-top: 4px; }
    th { background: #172a42; color: #ffffff; text-align: left; padding: 6px; font-size: 9px; }
    td { padding: 6px; border-bottom: 1px solid #e6edf2; vertical-align: top; font-size: 9px; }
    tbody tr:nth-child(even) { background: #f6f9fb; }
    .tag { background: #e6f7f2; color: #0f766e; border-radius: 999px; padding: 1px 5px; font-size: 8px; font-weight: bold; }
  </style>
</head>
<body>
  <header>
    <h1>BangkaGo Manifest</h1>
    <p>Generated ${esc(generated)}</p>
  </header>
  ${entries.map(bookingSection).join('')}
</body>
</html>`;
}

export async function shareManifestPdf(entries: ManifestPdfEntry[]): Promise<void> {
  if (!entries.length) throw new Error('No bookings to export.');
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Sharing is not available on this device.');
  }

  const { uri } = await Print.printToFileAsync({ html: buildHtml(entries) });
  const ref = entries.length === 1 ? entries[0].booking.ref : `${entries.length}-bookings`;
  await Sharing.shareAsync(uri, {
    mimeType: 'application/pdf',
    dialogTitle: `Share manifest ${ref}`,
    UTI: 'com.adobe.pdf',
  });
}
