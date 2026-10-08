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
