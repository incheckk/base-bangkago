// BangkaGo payment gateway — ONE edge function, five actions.
//
// The point of this file is that the money loop has no admin in it:
//   passenger taps Pay  -> create-checkout -> checkout -> Authorize
//   -> confirm_gateway_downpayment() flips the booking open
//   -> trip completes -> queue_gateway_payout trigger
//   -> payout -> claim_gateway_payouts() -> provider -> record_gateway_payout()
//
// TODAY IT RUNS IN SANDBOX: the "provider" is our own checkout sheet, drawn by
// the app (payment.tsx), because Supabase rewrites text/html to text/plain on
// the default domain — a hosted page here can never render. Same money path
// either way. The provider contract is the one PayMongo/Maya expose, so going
// live is GATEWAY_MODE=live + GATEWAY_BASE_URL + GATEWAY_KEY, not a rewrite:
// live hands the app a real provider URL to open instead.
//
// Deploy: Supabase dashboard -> Edge Functions -> new function "gateway" ->
// paste this file -> turn OFF "Enforce JWT verification" (the webhook is called
// by a provider, not a signed-in user; every action below authenticates itself
// or its signature). Secrets: GATEWAY_SECRET (webhook signing, required),
// GATEWAY_MODE ("sandbox" default), GATEWAY_BASE_URL, GATEWAY_KEY (live only).
// Verify a deploy with GET .../functions/v1/gateway?health=1 — it names the
// missing secret or unrun migration instead of guessing.
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

async function loadCheckout(
  downpaymentId: string,
): Promise<{ row: CheckoutRow | null; error: string | null }> {
  const { data, error } = await admin
    .from('downpayments')
    .select(
      'id, amount, status, gateway_checkout_ref, booking_id, boat_rental_id,' +
        ' booking:bookings(ref, user_id, from_port_name, to_port_name),' +
        ' rental:boat_rentals(event_name, user_id)',
    )
    .eq('id', downpaymentId)
    .maybeSingle();
  // 096 not run is the common one: the column does not exist. Say it.
  if (error) return { row: null, error: error.message };
  if (!data) return { row: null, error: null };
  const row = data as any;
  const booking = row.booking ?? null;
  const rental = row.rental ?? null;
  return {
    error: null,
    row: {
      id: row.id,
      amount: Number(row.amount),
      status: row.status,
      gateway_checkout_ref: row.gateway_checkout_ref ?? null,
      owner: booking?.user_id ?? rental?.user_id ?? null,
      label: booking
        ? `${booking.ref ?? 'Trip'} · ${booking.from_port_name ?? ''} → ${booking.to_port_name ?? ''}`.trim()
        : rental?.event_name ?? 'Boat rental',
    },
  };
}

async function createCheckout(req: Request, input: any): Promise<Response> {
  const uid = await callerId(req);
  if (!uid) return json({ error: 'Sign in first.' }, 401);

  const downpayment_id = input?.downpayment_id;
  if (!downpayment_id) return json({ error: 'downpayment_id is required.' }, 400);

  const loaded = await loadCheckout(String(downpayment_id));
  if (loaded.error) return json({ error: loaded.error }, 500);
  const row = loaded.row;
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
    ref = again.row?.gateway_checkout_ref ?? ref;
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

  // Sandbox: the app draws the checkout sheet and calls sandbox-authorize,
  // because a hosted page on *.supabase.co is served as text/plain.
  return json({ sandbox: { ref, amount: row.amount, label: row.label } });
}

// ---------------------------------------------------------------- sandbox authorize

/**
 * The sandbox "provider" approving a payment. The caller is the app, already
 * signed in, so a JWT + ownership check replaces the old page signature.
 */
async function sandboxAuthorize(req: Request, input: any): Promise<Response> {
  if (MODE === 'live') {
    return json({ error: 'Sandbox checkout is off in live mode.' }, 400);
  }

  const uid = await callerId(req);
  if (!uid) return json({ error: 'Sign in first.' }, 401);

  const loaded = await loadCheckout(String(input?.downpayment_id ?? ''));
  if (loaded.error) return json({ error: loaded.error }, 500);
  const row = loaded.row;
  if (!row) return json({ error: 'Downpayment not found.' }, 404);
  if (row.owner !== uid && !(await isAdmin(uid))) {
    return json({ error: 'That downpayment is not yours.' }, 403);
  }
  if (row.status !== 'pending') return json({ already: true, status: row.status });

  const ref = row.gateway_checkout_ref;
  if (!ref) return json({ error: 'No checkout reference on this downpayment.' }, 400);

  const { error: eventError } = await admin
    .from('gateway_events')
    .insert({ event_id: `sandbox:${ref}`, kind: 'sandbox.paid', payload: { ref } });
  // A replay from a double tap is a success, not an error.
  if (eventError && eventError.code !== '23505') {
    return json({ error: eventError.message }, 500);
  }

  const providerRef = `SBX-${Date.now().toString(36).toUpperCase()}`;
  const { error } = await admin.rpc('confirm_gateway_downpayment', {
    p_checkout_ref: ref,
    p_provider_ref: providerRef,
    p_paid_amount: row.amount,
  });
  if (error && !/already|approved/i.test(error.message)) {
    return json({ error: error.message }, 500);
  }
  return json({ ok: true, provider_ref: providerRef });
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

// ---------------------------------------------------------------- health

/**
 * Unauthenticated probe for a deploy in a hurry: open
 * `.../functions/v1/gateway?health=1` in a browser. It answers whether the
 * function is live, whether its secrets exist and whether 096 ran — with
 * booleans only, never the secrets themselves.
 */
async function health(): Promise<Response> {
  const [downpayments, flags] = await Promise.all([
    admin.from('downpayments').select('gateway_checkout_ref').limit(1),
    admin.from('dev_flags').select('manual_payments').eq('id', 1).maybeSingle(),
  ]);
  const needs: string[] = [];
  if (!SECRET) needs.push('set GATEWAY_SECRET (Edge Functions → Secrets)');
  if (!SERVICE_KEY) needs.push('SUPABASE_SERVICE_ROLE_KEY is missing');
  if (!ANON_KEY) needs.push('SUPABASE_ANON_KEY is missing (callers cannot be verified)');
  if (downpayments.error || flags.error) needs.push('run migrations 095 → 100');
  if (flags.data?.manual_payments !== false) {
    needs.push('Developer Options → Manual payments OFF');
  }
  return json({
    ok: needs.length === 0,
    mode: MODE,
    hasSecret: !!SECRET,
    hasServiceKey: !!SERVICE_KEY,
    hasAnonKey: !!ANON_KEY,
    migration096: !downpayments.error && !flags.error,
    manualPayments: flags.data?.manual_payments ?? null,
    needs,
  });
}

// ---------------------------------------------------------------- router

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const url = new URL(req.url);

  if (url.searchParams.has('health')) return health();

  // Live mode's provider redirect lands here; sandbox never leaves the app.
  if (url.searchParams.has('done')) return json({ ok: true });

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
    case 'sandbox-authorize':
      return sandboxAuthorize(req, body);
    case 'webhook':
      return webhook(raw, req.headers.get('x-gateway-signature') ?? '');
    case 'payout':
      return payout(req, body);
    default:
      return json({ error: 'Unknown action.' }, 400);
  }
});
