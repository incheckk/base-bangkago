import { supabase } from './supabase';
import type { SafetyAlertDoc, AlertSeverity } from '../types/models';

function mapRow(row: any): SafetyAlertDoc {
  return {
    alertId: row.id,
    message: row.message,
    severity: row.severity,
    isResolved: row.is_resolved,
    createdAt: row.created_at,
    bangkaId: row.bangka_id,
    portId: row.port_id,
  };
}

export async function createAlert(alert: {
  message: string;
  severity: AlertSeverity;
  bangkaId?: string;
  portId?: string;
}): Promise<SafetyAlertDoc> {
  const { data, error } = await supabase
    .from('safety_alerts')
    .insert({
      message: alert.message,
      severity: alert.severity,
      bangka_id: alert.bangkaId ?? null,
      port_id: alert.portId ?? null,
    })
    .select()
    .single();

  if (error) throw error;
  return mapRow(data);
}

export async function getAlerts(
  portId?: string,
  includeResolved = true
): Promise<SafetyAlertDoc[]> {
  let query = supabase.from('safety_alerts').select('*');

  if (portId) {
    query = query.eq('port_id', portId);
  }

  if (!includeResolved) {
    query = query.eq('is_resolved', false);
  }

  const { data, error } = await query.order('created_at', { ascending: false });

  if (error) throw error;
  return (data ?? []).map(mapRow);
}

/**
 * Bangkero-facing feed (migration 069). Own alerts and admin/coastguard
 * callers keep the full message; every other bangkero gets severity + port +
 * time with a generic line, so a name or GPS never leaks between boats.
 * Before 069 runs the RPC is missing — fall back to today's full read rather
 * than silently emptying the SOS history.
 */
export async function getAlertFeed(): Promise<SafetyAlertDoc[]> {
  const { data, error } = await supabase.rpc('alert_feed');
  if (error) return getAlerts(undefined, true);
  return (data ?? []).map(mapRow);
}

export async function resolveAlert(alertId: string): Promise<void> {
  const { error } = await supabase
    .from('safety_alerts')
    .update({ is_resolved: true })
    .eq('id', alertId);

  if (error) throw error;
}

/**
 * Passenger SOS (007 grants `safety_alerts_insert_passenger`). The row lands
 * in the same feed the coastguard and admin resolve; the passenger's boat is
 * the operator's boat, so the message carries the trip and ports instead of a
 * bangka_id the passenger is not allowed to look up.
 */
export async function sendPassengerSos(args: {
  passengerName: string;
  bookingRef?: string | null;
  fromPort?: string | null;
  toPort?: string | null;
}): Promise<SafetyAlertDoc> {
  const trip = args.bookingRef ? ` (booking ${args.bookingRef})` : '';
  const where = args.fromPort
    ? ` At ${args.fromPort}${args.toPort ? ` → ${args.toPort}` : ''}.`
    : '';
  return createAlert({
    message:
      `Emergency SOS from passenger ${args.passengerName}${trip}.${where} ` +
      'Immediate assistance needed.',
    severity: 'critical',
  });
}
