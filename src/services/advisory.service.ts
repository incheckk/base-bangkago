import { supabase } from './supabase';

/**
 * The coastguard's sailing advisory (migration 069). One row, read by every
 * role so the banner and the gate agree. Before 069 runs the table does not
 * exist — the app treats that as "no advisory", never as an error.
 */
export interface SailingAdvisory {
  /** True while suspended AND not past expires_at. */
  active: boolean;
  reason: string | null;
  source: string;
  suspendedAt: string | null;
  expiresAt: string | null;
}

function mapRow(row: any): SailingAdvisory {
  const expiresAt: string | null = row.expires_at ?? null;
  const live = !expiresAt || new Date(expiresAt).getTime() > Date.now();
  return {
    active: !!row.is_suspended && live,
    reason: row.reason ?? null,
    source: row.source ?? 'coastguard',
    suspendedAt: row.suspended_at ?? null,
    expiresAt,
  };
}

export async function getSailingAdvisory(): Promise<SailingAdvisory | null> {
  const { data, error } = await supabase
    .from('sailing_advisory')
    .select('is_suspended, reason, source, suspended_at, expires_at')
    .eq('id', 1)
    .maybeSingle();

  // 42P01 / PGRST205 = table not migrated yet. Degrade quietly.
  if (error) return null;
  return data ? mapRow(data) : null;
}

export async function setSailingAdvisory(input: {
  suspended: boolean;
  reason?: string;
  source?: 'coastguard' | 'weather' | 'admin_override';
  /** 0 = no automatic expiry. */
  hours?: number;
}): Promise<void> {
  const { error } = await supabase.rpc('set_sailing_advisory', {
    p_suspended: input.suspended,
    p_reason: input.reason ?? null,
    p_source: input.source ?? 'coastguard',
    p_hours: input.hours ?? 6,
  });
  if (error) throw error;
}

/** Only clears a weather-sourced advisory. Returns true when it did. */
export async function maybeAutoClearAdvisory(safe: boolean): Promise<boolean> {
  const { data, error } = await supabase.rpc('maybe_auto_clear_advisory', { p_safe: safe });
  if (error) throw error;
  return !!data;
}
