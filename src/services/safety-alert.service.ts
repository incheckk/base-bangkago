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

export async function resolveAlert(alertId: string): Promise<void> {
  const { error } = await supabase
    .from('safety_alerts')
    .update({ is_resolved: true })
    .eq('id', alertId);

  if (error) throw error;
}
