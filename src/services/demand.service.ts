import { supabase } from './supabase';
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

export async function getTodayPredictions(): Promise<DemandPredictionDoc[]> {
  const today = new Date().toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from('demand_predictions')
    .select('*')
    .eq('prediction_date', today)
    .order('hour_of_day');

  if (error) throw error;
  return (data ?? []).map(mapRow);
}
