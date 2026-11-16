import { supabase } from './supabase';

/**
 * The admin demo switch (migration 009). While ON, the FCFS rules
 * (port queue, dwell, GPS freshness, route lock, capacity) are lifted;
 * availability, the open-booking state and the 3-minute hold rule stay.
 */
export async function getDispatchBypass(): Promise<boolean> {
  const { data, error } = await supabase
    .from('dev_flags')
    .select('dispatch_bypass')
    .eq('id', 1)
    .maybeSingle();
  if (error) throw error;
  return data?.dispatch_bypass ?? false;
}

/** Admin-only — enforced inside the RPC (users.user_role = 'admin'). */
export async function setDispatchBypass(on: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_dispatch_bypass', { p_on: on });
  if (error) throw error;
}

/**
 * The bangkero-gates switch (migration 010). While ON, the document
 * verification + boat requirement for going online and the documents +
 * rating floor for offers/accepts are all lifted. Independent of the
 * dispatch bypass.
 */
export async function getGatesBypass(): Promise<boolean> {
  const { data, error } = await supabase
    .from('dev_flags')
    .select('gates_bypass')
    .eq('id', 1)
    .maybeSingle();
  if (error) throw error;
  return data?.gates_bypass ?? false;
}

/** Admin-only — enforced inside the RPC (users.user_role = 'admin'). */
export async function setGatesBypass(on: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_gates_bypass', { p_on: on });
  if (error) throw error;
}

/**
 * The route lock's own switch (migration 079). The FCFS switch no longer
 * lifts it: a boat with an accepted trip to one destination still refuses
 * another destination unless THIS flag is on.
 */
export async function getRouteLockBypass(): Promise<boolean> {
  const { data, error } = await supabase
    .from('dev_flags')
    .select('route_lock_bypass')
    .eq('id', 1)
    .maybeSingle();
  if (error) throw error;
  return data?.route_lock_bypass ?? false;
}

/** Admin-only — enforced inside the RPC (users.user_role = 'admin'). */
export async function setRouteLockBypass(on: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_route_lock_bypass', { p_on: on });
  if (error) throw error;
}

/**
 * The arrival close-out switch (migration 026). While ON, the arrived
 * screen can complete trips whose passengers were never marked onboarded
 * (force_complete_trip). Independent of the other two flags.
 */
export async function getArrivalBypass(): Promise<boolean> {
  const { data, error } = await supabase
    .from('dev_flags')
    .select('arrival_bypass')
    .eq('id', 1)
    .maybeSingle();
  if (error) throw error;
  return data?.arrival_bypass ?? false;
}

/** Admin-only — enforced inside the RPC (users.user_role = 'admin'). */
export async function setArrivalBypass(on: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_arrival_bypass', { p_on: on });
  if (error) throw error;
}

/**
 * Demo quick-login chips on the sign-in screen (migration 069). The reader is
 * a SECURITY DEFINER RPC because the sign-in screen has no session yet.
 * Pre-069 the function is missing — show the chips (the old behaviour) rather
 * than break the development flow.
 */
export async function getShowQuickLogin(): Promise<boolean> {
  const { data, error } = await supabase.rpc('demo_quick_login_enabled');
  if (error) return true;
  return data !== false;
}

/** Admin-only — enforced inside the RPC (users.user_role = 'admin'). */
export async function setShowQuickLogin(on: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_show_quick_login', { p_on: on });
  if (error) throw error;
}

/**
 * The demo ports switch (migration 086). The school (ST Building) and Home
 * stops are ordinary ports/routes inserted INACTIVE by the migration; this
 * flips every `demo-` row. Returns null when 086 has not been run, so the
 * screen hides the switch instead of offering a dead toggle.
 */
export async function getDemoPorts(): Promise<boolean | null> {
  const { data, error } = await supabase
    .from('ports')
    .select('is_active')
    .like('id', 'demo-%')
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? data.is_active : null;
}

/** Admin-only via the existing ports/routes admin UPDATE policies. */
export async function setDemoPorts(on: boolean): Promise<void> {
  const { error: portErr } = await supabase
    .from('ports')
    .update({ is_active: on })
    .like('id', 'demo-%');
  if (portErr) throw portErr;
  const { error: routeErr } = await supabase
    .from('routes')
    .update({ is_active: on })
    .like('id', 'demo-%');
  if (routeErr) throw routeErr;
}

/**
 * The same-day rental switch (migration 089). OFF is the production rule:
 * the rental form's strip starts tomorrow. null when 089 has not run, so
 * the admin screen hides the switch.
 */
export async function getRentalToday(): Promise<boolean | null> {
  const { data, error } = await supabase.rpc('demo_rental_today_enabled');
  if (error) return null;
  return data === true;
}

/** Admin-only — enforced inside the RPC (users.user_role = 'admin'). */
export async function setRentalToday(on: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_rental_today', { p_on: on });
  if (error) throw error;
}

/**
 * 096 — the break-glass switch. true = the manual receipt upload + admin
 * release (today's flow). false = the gateway checkout + automatic payout.
 * Unrun 096 reads as manual, which is the safe default.
 */
export async function getManualPayments(): Promise<boolean> {
  const { data, error } = await supabase
    .from('dev_flags')
    .select('manual_payments')
    .eq('id', 1)
    .maybeSingle();
  if (error) throw error;
  return data?.manual_payments !== false;
}

/** Admin-only — enforced inside the RPC. */
export async function setManualPayments(on: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_manual_payments', { p_on: on });
  if (error) throw error;
}
