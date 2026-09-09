import { supabase } from './supabase';
import type { PortDoc, RouteDoc, RouteStopDoc } from '../types/models';

function mapPortRow(row: any): PortDoc {
  return {
    portId: row.id,
    portName: row.port_name,
    location: row.location,
    latitude: row.latitude,
    longitude: row.longitude,
    sortOrder: row.sort_order,
    isActive: row.is_active,
  };
}

function mapRouteRow(row: any): RouteDoc {
  return {
    routeId: row.id,
    distanceKm: row.distance_km,
    baseFare: row.base_fare,
    estimatedMinutes: row.estimated_minutes,
    isActive: row.is_active,
    startPortId: row.start_port_id,
    endPortId: row.end_port_id,
  };
}

export async function getAllPorts(): Promise<PortDoc[]> {
  const { data, error } = await supabase
    .from('ports')
    .select('*')
    .order('sort_order');

  if (error) throw error;
  return (data ?? []).map(mapPortRow);
}

export async function createPort(port: Omit<PortDoc, 'sortOrder'> & { sortOrder?: number }) {
  const { data, error } = await supabase
    .from('ports')
    .insert({
      id: port.portId,
      port_name: port.portName,
      location: port.location,
      latitude: port.latitude,
      longitude: port.longitude,
      sort_order: port.sortOrder ?? 0,
      is_active: port.isActive,
    })
    .select()
    .single();

  if (error) throw error;
  return mapPortRow(data);
}

export async function updatePort(portId: string, updates: Partial<PortDoc>) {
  const payload: Record<string, any> = {};
  if (updates.portName !== undefined) payload.port_name = updates.portName;
  if (updates.location !== undefined) payload.location = updates.location;
  if (updates.latitude !== undefined) payload.latitude = updates.latitude;
  if (updates.longitude !== undefined) payload.longitude = updates.longitude;
  if (updates.isActive !== undefined) payload.is_active = updates.isActive;

  const { error } = await supabase.from('ports').update(payload).eq('id', portId);
  if (error) throw error;
}

export async function deletePort(portId: string) {
  const { error } = await supabase.from('ports').delete().eq('id', portId);
  if (error) throw error;
}

export async function getAllRoutes(): Promise<RouteDoc[]> {
  const { data, error } = await supabase
    .from('routes')
    .select('*')
    .order('base_fare');

  if (error) throw error;
  return (data ?? []).map(mapRouteRow);
}

export async function createRoute(route: RouteDoc) {
  const { data, error } = await supabase
    .from('routes')
    .insert({
      id: route.routeId,
      distance_km: route.distanceKm,
      base_fare: route.baseFare,
      estimated_minutes: route.estimatedMinutes,
      is_active: route.isActive,
      start_port_id: route.startPortId,
      end_port_id: route.endPortId,
    })
    .select()
    .single();

  if (error) throw error;
  return mapRouteRow(data);
}

export async function updateRoute(routeId: string, updates: Partial<RouteDoc>) {
  const payload: Record<string, any> = {};
  if (updates.baseFare !== undefined) payload.base_fare = updates.baseFare;
  if (updates.estimatedMinutes !== undefined) payload.estimated_minutes = updates.estimatedMinutes;
  if (updates.distanceKm !== undefined) payload.distance_km = updates.distanceKm;
  if (updates.isActive !== undefined) payload.is_active = updates.isActive;

  const { error } = await supabase.from('routes').update(payload).eq('id', routeId);
  if (error) throw error;
}

export async function deleteRoute(routeId: string) {
  const { error } = await supabase.from('routes').delete().eq('id', routeId);
  if (error) throw error;
}

function mapStopRow(row: any): RouteStopDoc {
  return {
    stopId: row.id,
    routeId: row.route_id,
    portId: row.port_id,
    stopOrder: row.stop_order,
  };
}

export async function getStopsByRoute(routeId: string): Promise<RouteStopDoc[]> {
  const { data, error } = await supabase
    .from('route_stops')
    .select('*')
    .eq('route_id', routeId)
    .order('stop_order');

  if (error) throw error;
  return (data ?? []).map(mapStopRow);
}

export async function createRouteStop(stop: Omit<RouteStopDoc, 'stopId'>): Promise<RouteStopDoc> {
  const { data, error } = await supabase
    .from('route_stops')
    .insert({
      route_id: stop.routeId,
      port_id: stop.portId,
      stop_order: stop.stopOrder,
    })
    .select()
    .single();

  if (error) throw error;
  return mapStopRow(data);
}

export async function deleteRouteStopsByRoute(routeId: string): Promise<void> {
  const { error } = await supabase.from('route_stops').delete().eq('route_id', routeId);
  if (error) throw error;
}
