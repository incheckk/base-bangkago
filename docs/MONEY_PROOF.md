# Money proof for the panel

Manual payments are the demo default (`dev_flags.manual_payments = true`).
This is the shortest chain that shows, on screen, where the passenger's
50% goes and what the bangkero actually receives.

Prereqs: migrations **095 → 096 → 097 → 098** are applied, the admin's
GCash QR is uploaded (Admin → GCash QR), and Developer Options → **Manual
payments** is ON.

## The chain (two phones + admin)

1. **Passenger** books an advance trip. On Payment, scan the admin's GCash
   QR, send 50% of the fare, tap the receipt upload, and confirm.
   The booking shows **Awaiting BangkaGo confirmation** and the downpayment
   row says **Awaiting review**.
2. **Admin** opens Downpayments → **Pending**. Reads the Ref No. off the
   receipt, checks it in GCash, then taps **Approve downpayment**.
   The booking opens; an advance trip is offered to a bangkero on its
   sailing day (the demo dispatch bypass can offer it immediately).
3. **Bangkero** accepts, sails, and completes the trip (boarding → en
   route → arrived → Complete Trip).
4. **Admin** opens Downpayments → **To release**. The row now shows the
   exact net: `₱500 held − ₱70 commission` (7% of the ₱1,000 whole fare).
   The admin sends that net to the bangkero's GCash QR (or hands over cash),
   enters the GCash ref, and taps **Release**.
5. **Bangkero** opens Earnings. **RELEASED TO YOU** shows
   `GROSS ₱500.00 · RELEASED ₱430.00` and the per-trip row, plus a
   "Downpayment released" notification.

## The database row (screenshot this)

Run in Supabase SQL editor:

```sql
select
  d.id,
  b.ref                        as booking_ref,
  d.amount                     as held,
  d.commission_rate,
  d.commission_amount,
  d.amount - d.commission_amount as net_to_bangkero,
  d.status,
  d.released_at,
  d.released_to,
  d.payout_method,
  d.payout_ref
from downpayments d
join bookings b on b.id = d.booking_id
where b.ref = 'BGO-XXXX'       -- the booking shown on screen
order by d.created_at desc;
```

That single row is the proof: the held amount, the commission taken, the
net paid, when it was released, to which bangkero, by which method, and the
GCash reference.

## If the receipt is wrong

Admin taps **Reject receipt** and types the reason (e.g. "Ref No. not found
in GCash"). The booking **stays pending and payable**, the passenger sees
`rejected — pay again` + **Pay ₱x downpayment** on the booking, and can
file a new receipt for the same booking. Nothing is cancelled and no
"refund" is claimed. **Refund** remains for money that actually arrived and
must go back.
