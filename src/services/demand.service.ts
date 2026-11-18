import { supabase } from './supabase';
import { manilaTodayIso } from '../utils/date';
import type { DemandPredictionDoc } from '../types/models';

function mapRow(row: any): DemandPredictionDoc {
  return {
    predictionId: row.id,
    predictionDate: row.prediction_date,
    dayOfWeek: row.day_of_week,
    hourOfDay: row.hour_of_day,
    isWeekend: row.is_weekend,
    isHoliday: row.is_holiday,
    previousDemand: row.previous_demand,
    avgDemandLast7Days: row.avg_demand_last_7_days,
    avgDemandLast30Days: row.avg_demand_last_30_days,
    predictedPassengers: row.predicted_passengers,
    confidenceScore: row.confidence_score,
    weatherId: row.weather_id,
    routeId: row.route_id,
  };
}

export async function getDemandForRoute(
  routeId: string,
  date?: string
): Promise<DemandPredictionDoc[]> {
  let query = supabase
    .from('demand_predictions')
    .select('*')
    .eq('route_id', routeId);

  if (date) {
    query = query.eq('prediction_date', date);
  }

  const { data, error } = await query.order('hour_of_day');

  if (error) throw error;
  return (data ?? []).map(mapRow);
}

export interface RouteDemandSummary {
  routeId: string;
  totalPredicted: number;
  avgDailyPredicted: number;
  daysWithData: number;
}

/**
 * One route's predicted passengers for ONE day (default today, Manila) —
 * the same rows Admin → Analyze Demand reads for its default view. It used
 * to sum every prediction date on file, so the phone said 22 where the
 * console said 11.
 */
export async function getRouteDemandSummary(
  date: string = manilaTodayIso()
): Promise<RouteDemandSummary[]> {
  const { data, error } = await supabase
    .from('demand_predictions')
    .select('route_id, predicted_passengers, prediction_date')
    .eq('prediction_date', date);

  if (error) throw error;

  const byRoute = new Map<string, { total: number; dates: Set<string> }>();
  for (const row of data ?? []) {
    if (!row.route_id) continue;
    const entry = byRoute.get(row.route_id) ?? { total: 0, dates: new Set<string>() };
    entry.total += Number(row.predicted_passengers) || 0;
    if (row.prediction_date) entry.dates.add(row.prediction_date);
    byRoute.set(row.route_id, entry);
  }

  return [...byRoute.entries()]
    .map(([routeId, entry]) => ({
      routeId,
      totalPredicted: entry.total,
      avgDailyPredicted: entry.dates.size > 0 ? Math.round(entry.total / entry.dates.size) : 0,
      daysWithData: entry.dates.size,
    }))
    // Same tie-break as the admin table, so equal totals keep one order.
    .sort((a, b) => b.totalPredicted - a.totalPredicted || a.routeId.localeCompare(b.routeId));
}

export async function getTodayPredictions(): Promise<DemandPredictionDoc[]> {
  const today = manilaTodayIso();

  const { data, error } = await supabase
    .from('demand_predictions')
    .select('*')
    .eq('prediction_date', today)
    .order('hour_of_day');

  if (error) throw error;
  return (data ?? []).map(mapRow);
}
