// BangkaGo payment gateway — ONE edge function, five actions.
//
// The point of this file is that the money loop has no admin in it:
//   passenger taps Pay  -> create-checkout -> hosted page -> Authorize
//   -> webhook -> confirm_gateway_downpayment() flips the booking open
//   -> trip completes -> queue_gateway_payout trigger
//   -> payout -> claim_gateway_payouts() -> provider -> record_gateway_payout()
//
// TODAY IT RUNS IN SANDBOX: the "provider" is the signed page this same
// function renders ("BangkaGo Sandbox Checkout"), so a panel can watch a real
// redirect -> approve -> app-flips sequence without a paused PayMongo sign-up.
// The provider contract is the same one PayMongo/Maya expose, so going live is
// GATEWAY_MODE=live + GATEWAY_BASE_URL + GATEWAY_KEY, not a rewrite.
//
// Deploy: Supabase dashboard -> Edge Functions -> new function "gateway" ->
// paste this file -> turn OFF "Enforce JWT verification" (the sandbox page and
// the webhook are called by a browser/provider, not a signed-in user; every
// action below authenticates itself). Secrets: GATEWAY_SECRET (required),
// GATEWAY_MODE ("sandbox" default), GATEWAY_BASE_URL, GATEWAY_KEY (live only).
//
// shortcut: the live payout branch posts PayMongo's disbursement shape and is
// untested against a real account, because sign-ups are paused; verify it with
// sandbox keys before switching GATEWAY_MODE=live.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;

// Projects on the new key system inject JSON dictionaries
// (SUPABASE_SECRET_KEYS); older ones inject the legacy JWT keys. Read
// whichever this project has, so the same file deploys to both.
function keyFromJson(name: string): string {
  const raw = Deno.env.get(name);
  if (!raw) return '';
  try {
    const parsed = JSON.parse(raw);
    return parsed.default ?? Object.values(parsed)[0] ?? '';
  } catch {
    return '';
  }
}

const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || keyFromJson('SUPABASE_PUBLISHABLE_KEYS');
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || keyFromJson('SUPABASE_SECRET_KEYS');
const SECRET = Deno.env.get('GATEWAY_SECRET') ?? '';
const MODE = (Deno.env.get('GATEWAY_MODE') ?? 'sandbox').toLowerCase();
const BASE_URL = Deno.env.get('GATEWAY_BASE_URL') ?? '';
const GATEWAY_KEY = Deno.env.get('GATEWAY_KEY') ?? '';

if (!SERVICE_KEY || !ANON_KEY) {
  console.error(
    'gateway: no Supabase API keys in this runtime — every DB call will fail. ' +
      'Check Project Settings → API Keys.',
  );
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-gateway-signature',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

// ---------------------------------------------------------------- signing

async function hmac(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Length-safe compare — a checkout ref must not be forgeable by timing. */
function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const peso = (n: number) =>
  `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

// ---------------------------------------------------------------- identity

async function callerId(req: Request): Promise<string | null> {
  const auth = req.headers.get('Authorization');
  if (!auth) return null;
  const client = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data } = await client.auth.getUser();
  return data.user?.id ?? null;
}

async function isAdmin(uid: string): Promise<boolean> {
  const { data } = await admin.from('users').select('user_role').eq('id', uid).maybeSingle();
  return data?.user_role === 'admin';
}

async function manualPayments(): Promise<boolean> {
  const { data } = await admin.from('dev_flags').select('manual_payments').eq('id', 1).maybeSingle();
  return data?.manual_payments !== false;
}

// ---------------------------------------------------------------- checkout

interface CheckoutRow {
  id: string;
  amount: number;
  status: string;
  gateway_checkout_ref: string | null;
  owner: string | null;
  label: string;
}

async function loadCheckout(downpaymentId: string): Promise<CheckoutRow | null> {
  const { data } = await admin
    .from('downpayments')
    .select(
      'id, amount, status, gateway_checkout_ref, booking_id, boat_rental_id,' +
        ' booking:bookings(ref, user_id, from_port_name, to_port_name),' +
        ' rental:boat_rentals(event_name, user_id)',
    )
    .eq('id', downpaymentId)
    .maybeSingle();
  if (!data) return null;
  const row = data as any;
  const booking = row.booking ?? null;
  const rental = row.rental ?? null;
  return {
    id: row.id,
    amount: Number(row.amount),
    status: row.status,
    gateway_checkout_ref: row.gateway_checkout_ref ?? null,
    owner: booking?.user_id ?? rental?.user_id ?? null,
    label: booking
      ? `${booking.ref ?? 'Trip'} · ${booking.from_port_name ?? ''} → ${booking.to_port_name ?? ''}`.trim()
      : rental?.event_name ?? 'Boat rental',
  };
}

async function createCheckout(req: Request, input: any): Promise<Response> {
  const uid = await callerId(req);
  if (!uid) return json({ error: 'Sign in first.' }, 401);

  const downpayment_id = input?.downpayment_id;
  if (!downpayment_id) return json({ error: 'downpayment_id is required.' }, 400);

  const row = await loadCheckout(String(downpayment_id));
  if (!row) return json({ error: 'Downpayment not found.' }, 404);
  if (row.owner !== uid && !(await isAdmin(uid))) {
    return json({ error: 'That downpayment is not yours.' }, 403);
  }
  if (row.status !== 'pending') {
    return json({ already: true, status: row.status });
  }

  let ref = row.gateway_checkout_ref;
  if (!ref) {
    ref = `bg_${crypto.randomUUID().replace(/-/g, '')}`;
    const { error } = await admin
      .from('downpayments')
      .update({ gateway_checkout_ref: ref })
      .eq('id', row.id)
      .is('gateway_checkout_ref', null);
    if (error) return json({ error: error.message }, 500);
    const again = await loadCheckout(row.id);
    ref = again?.gateway_checkout_ref ?? ref;
  }

  if (MODE === 'live') {
    // Same contract, real provider: POST the session, hand back its redirect.
    const resp = await fetch(`${BASE_URL}/checkout_sessions`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(`${GATEWAY_KEY}:`)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        data: {
          attributes: {
            line_items: [{
              name: row.label,
              amount: Math.round(row.amount * 100),
              currency: 'PHP',
              quantity: 1,
            }],
            payment_method_types: ['gcash'],
            reference_number: ref,
            success_url: `${SUPABASE_URL}/functions/v1/gateway?done=1`,
            cancel_url: `${SUPABASE_URL}/functions/v1/gateway?done=0`,
          },
        },
      }),
    });
    const body = await resp.json().catch(() => ({}));
    const url = body?.data?.attributes?.checkout_url;
    if (!resp.ok || !url) {
      return json({ error: body?.errors?.[0]?.detail ?? 'The gateway refused the checkout.' }, 502);
    }
    return json({ url });
  }

  const sig = await hmac(ref);
  const url = `${SUPABASE_URL}/functions/v1/gateway?sandbox=1&ref=${encodeURIComponent(ref)}&sig=${sig}`;
  return json({ url });
}

// ---------------------------------------------------------------- sandbox page

function page(title: string, inner: string): Response {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
    background:#0A1620;color:#F7F8F6;font:16px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;padding:24px}
  .card{width:100%;max-width:420px;background:#12222F;border:1px solid #24384A;border-radius:18px;padding:28px}
  .brand{font-size:20px;font-weight:800;letter-spacing:-.4px;margin-bottom:2px}
  .brand span{color:#2FB69B}
  .sandbox{display:inline-block;margin-bottom:22px;padding:3px 10px;border-radius:999px;
    background:#3A2A10;color:#F2B54B;font-size:11px;font-weight:800;letter-spacing:1.4px}
  .row{display:flex;justify-content:space-between;gap:16px;padding:10px 0;border-top:1px solid #1E3346}
  .row:first-of-type{border-top:0}
  .k{color:#9FB0BF;font-size:13px}
  .v{font-size:14px;font-weight:600;text-align:right;word-break:break-word}
  .amount{font-size:34px;font-weight:800;margin:18px 0 6px}
  button{width:100%;height:52px;border:0;border-radius:12px;font-size:15px;font-weight:700;
    margin-top:12px;cursor:pointer}
  .ok{background:#2FB69B;color:#04141A}
  .no{background:transparent;color:#C9D6E1;border:1px solid #33495E}
  .note{color:#8496A6;font-size:12px;line-height:1.5;margin-top:18px}
  .tick{width:56px;height:56px;border-radius:28px;background:#173A33;color:#2FB69B;display:flex;
    align-items:center;justify-content:center;font-size:28px;font-weight:800;margin-bottom:18px}
</style></head><body><div class="card">${inner}</div></body></html>`,
    { headers: { ...CORS, 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } },
  );
}

async function sandboxPage(url: URL): Promise<Response> {
  const ref = url.searchParams.get('ref') ?? '';
  const sig = url.searchParams.get('sig') ?? '';
  if (!SECRET || !ref || !same(sig, await hmac(ref))) {
    return page('Invalid link', '<div class="brand">BangkaGo</div><p class="note">This checkout link is not valid.</p>');
  }

  const { data } = await admin
    .from('downpayments')
    .select('amount, status, booking:bookings(ref, from_port_name, to_port_name), rental:boat_rentals(event_name)')
    .eq('gateway_checkout_ref', ref)
    .maybeSingle();
  if (!data) {
    return page('Not found', '<div class="brand">BangkaGo</div><p class="note">This checkout no longer exists.</p>');
  }

  const row = data as any;
  const label = row.booking
    ? `${row.booking.ref ?? 'Trip'} · ${row.booking.from_port_name ?? ''} → ${row.booking.to_port_name ?? ''}`.trim()
    : row.rental?.event_name ?? 'Boat rental';

  if (row.status !== 'pending') {
    return page(
      'Already settled',
      `<div class="tick">✓</div><div class="brand">BangkaGo</div>
       <p class="note">This downpayment is already <strong>${esc(String(row.status))}</strong>. Nothing more to pay.</p>`,
    );
  }

  // Live mode still gets a page, but only as the "return to the app" landing.
  const action = `${SUPABASE_URL}/functions/v1/gateway?sandbox_pay=1`;
  return page(
    'BangkaGo Sandbox Checkout',
    `<div class="brand">Bangka<span>Go</span></div>
     <div class="sandbox">SANDBOX · NO REAL MONEY</div>
     <div class="k">Amount due</div>
     <div class="amount">${peso(Number(row.amount))}</div>
     <div class="row"><span class="k">Pay with</span><span class="v">GCash</span></div>
     <div class="row"><span class="k">For</span><span class="v">${esc(label)}</span></div>
     <div class="row"><span class="k">Reference</span><span class="v">${esc(ref)}</span></div>
     <form method="post" action="${esc(action)}">
       <input type="hidden" name="ref" value="${esc(ref)}">
       <input type="hidden" name="sig" value="${esc(sig)}">
       <button class="ok" name="decision" value="authorize">Authorize payment</button>
       <button class="no" name="decision" value="fail">Fail payment</button>
     </form>
     <p class="note">This is BangkaGo's own sandbox gateway, standing in for PayMongo while
     sign-ups are paused. Authorizing moves no pesos — it fires the same webhook a
     real provider would.</p>`,
  );
}

async function sandboxPay(req: Request): Promise<Response> {
  const form = new URLSearchParams(await req.text());
  const ref = form.get('ref') ?? '';
  const sig = form.get('sig') ?? '';
  const decision = form.get('decision');

  if (!SECRET || !ref || !same(sig, await hmac(ref))) {
    return page('Invalid link', '<div class="brand">BangkaGo</div><p class="note">This checkout link is not valid.</p>');
  }

  const { data } = await admin
    .from('downpayments')
    .select('amount')
    .eq('gateway_checkout_ref', ref)
    .maybeSingle();
  if (!data) {
    return page('Not found', '<div class="brand">BangkaGo</div><p class="note">This checkout no longer exists.</p>');
  }

  if (decision !== 'authorize') {
    return page(
      'Payment failed',
      `<div class="tick" style="background:#3A1A1A;color:#F26B6B">×</div>
       <div class="brand">BangkaGo</div>
       <p class="note">Nothing was charged. Close this page and try again from the app.</p>`,
    );
  }

  const eventId = `sandbox:${ref}`;
  const { error: eventError } = await admin
    .from('gateway_events')
    .insert({ event_id: eventId, kind: 'sandbox.paid', payload: { ref } });
  // A replay from a double tap is a success, not an error.
  if (eventError && eventError.code !== '23505') {
    return page('Gateway error', `<div class="brand">BangkaGo</div><p class="note">${esc(eventError.message)}</p>`);
  }

  const providerRef = `SBX-${Date.now().toString(36).toUpperCase()}`;
  const { error } = await admin.rpc('confirm_gateway_downpayment', {
    p_checkout_ref: ref,
    p_provider_ref: providerRef,
    p_paid_amount: Number(data.amount),
  });
  if (error && !/already|approved/i.test(error.message)) {
    return page('Gateway error', `<div class="brand">BangkaGo</div><p class="note">${esc(error.message)}</p>`);
  }

  return page(
    'Payment authorized',
    `<div class="tick">✓</div>
     <div class="brand">BangkaGo</div>
     <p class="note">Downpayment received. Return to the BangkaGo app — it will pick this up
     on its own. You can close this page.</p>`,
  );
}

// ---------------------------------------------------------------- webhook

async function webhook(raw: string, signature: string): Promise<Response> {
  if (!SECRET || !same(signature, await hmac(raw))) {
    return json({ error: 'Bad signature.' }, 401);
  }

  let event: any;
  try {
    event = JSON.parse(raw);
  } catch {
    return json({ error: 'Not JSON.' }, 400);
  }

  const eventId = String(event.event_id ?? '').trim();
  const ref = String(event.checkout_ref ?? '').trim();
  if (!eventId || !ref) return json({ error: 'event_id and checkout_ref are required.' }, 400);

  const { error: insertError } = await admin
    .from('gateway_events')
    .insert({ event_id: eventId, kind: event.status ?? null, payload: event });
  if (insertError) {
    if (insertError.code === '23505') return json({ ok: true, replay: true });
    return json({ error: insertError.message }, 500);
  }

  if (event.status !== 'paid') return json({ ok: true, ignored: true });

  const { error } = await admin.rpc('confirm_gateway_downpayment', {
    p_checkout_ref: ref,
    p_provider_ref: event.provider_ref ?? null,
    p_paid_amount: event.amount == null ? null : Number(event.amount),
  });
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true });
}

// ---------------------------------------------------------------- payout

interface ClaimRow {
  downpayment_id: string;
  gross: number;
  commission: number;
  net: number;
  label: string;
  account_name: string;
  account_number: string;
}

async function sendPayout(batch: ClaimRow[], ref: string): Promise<void> {
  const total = batch.reduce((sum, r) => sum + Number(r.net), 0);
  if (MODE !== 'live') return; // sandbox: our own ledger is the provider

  const resp = await fetch(`${BASE_URL}/disbursements`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${GATEWAY_KEY}:`)}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': ref,
    },
    body: JSON.stringify({
      data: {
        attributes: {
          amount: Math.round(total * 100),
          currency: 'PHP',
          recipient: { name: batch[0].account_name, number: batch[0].account_number },
          channel: 'gcash',
          reference_number: ref,
        },
      },
    }),
  });
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(body?.errors?.[0]?.detail ?? `Provider refused the payout (${resp.status}).`);
}

async function payout(req: Request, input: any): Promise<Response> {
  const uid = await callerId(req);
  if (!uid) return json({ error: 'Sign in first.' }, 401);

  const bangkero = String(input?.bangkero_id ?? '');
  if (!bangkero) return json({ error: 'bangkero_id is required.' }, 400);

  const staff = await isAdmin(uid);
  if (uid !== bangkero && !staff) return json({ error: 'Not your payout.' }, 403);

  // A bangkero can never pull a second payout by hand while the admin is on
  // the manual flow — the two rails must not both pay the same downpayment.
  if (!staff && (await manualPayments())) {
    return json({ skipped: 'manual payments are on' });
  }

  const { data, error } = await admin.rpc('claim_gateway_payouts', { p_bangkero: bangkero });
  if (error) return json({ error: error.message }, 400);

  const batch = (data ?? []) as ClaimRow[];
  if (batch.length === 0) return json({ paid: 0, count: 0 });

  const ids = batch.map((r) => r.downpayment_id);
  const ref = `PO-${Date.now().toString(36).toUpperCase()}`;

  try {
    await sendPayout(batch, ref);
  } catch (e) {
    await admin.rpc('record_gateway_payout', {
      p_ids: ids,
      p_ref: ref,
      p_status: 'failed',
      p_error: e instanceof Error ? e.message : String(e),
    });
    return json({ error: e instanceof Error ? e.message : String(e) }, 502);
  }

  const net = batch.reduce((sum, r) => sum + Number(r.net), 0);
  const { error: recordError } = await admin.rpc('record_gateway_payout', {
    p_ids: ids,
    p_ref: ref,
    p_status: 'paid',
  });
  if (recordError) return json({ error: recordError.message }, 500);

  return json({ paid: net, count: batch.length, ref });
}

// ---------------------------------------------------------------- router

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const url = new URL(req.url);

  // The browser's two hops through the sandbox: the page, then its form.
  if (url.searchParams.has('sandbox')) return sandboxPage(url);
  if (url.searchParams.has('sandbox_pay') && req.method === 'POST') return sandboxPay(req);
  if (url.searchParams.has('done')) {
    return page(
      'BangkaGo',
      `<div class="brand">Bangka<span>Go</span></div>
       <p class="note">Payment finished. Return to the BangkaGo app.</p>`,
    );
  }

  let raw = '';
  let body: any = {};
  if (req.method === 'POST') {
    raw = await req.text();
    try {
      body = JSON.parse(raw);
    } catch {
      body = {};
    }
  }

  switch (body.action) {
    case 'create-checkout':
      return createCheckout(req, body);
    case 'webhook':
      return webhook(raw, req.headers.get('x-gateway-signature') ?? '');
    case 'payout':
      return payout(req, body);
    default:
      return json({ error: 'Unknown action.' }, 400);
  }
});
