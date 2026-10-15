/**
 * Demand predictions service for web dashboards.
 * Queries demand_predictions table for ML forecasting data.
 */
(function() {
  'use strict';
  var svc = window.bangkagoServices;

  function mapPrediction(row) {
    return {
      id: row.id,
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
      routeId: row.route_id
    };
  }

  async function getPredictions(filters) {
    filters = filters || {};
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var q = c.from('demand_predictions').select('*');
    if (filters.routeId) q = q.eq('route_id', filters.routeId);
    if (filters.dateFrom) q = q.gte('prediction_date', filters.dateFrom);
    if (filters.dateTo) q = q.lte('prediction_date', filters.dateTo);
    q = q.order('prediction_date', { ascending: true }).order('hour_of_day', { ascending: true });
    if (filters.limit) q = q.limit(filters.limit);
    var r = await q;
    if (r.error) throw r.error;
    return (r.data || []).map(mapPrediction);
  }

  async function getRouteDemandSummary() {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    // Get predictions grouped by route for summary stats
    var r = await c.from('demand_predictions').select('route_id, predicted_passengers, confidence_score, prediction_date');
    if (r.error) throw r.error;
    var data = r.data || [];

    // Also get route names
    var routeIds = [...new Set(data.map(d => d.route_id).filter(Boolean))];
    var routeNames = {};
    if (routeIds.length > 0) {
      var routesResult = await c.from('routes').select('id, start_port_id, end_port_id').in('id', routeIds);
      if (!routesResult.error && routesResult.data) {
        var portIds = [...new Set(routesResult.data.flatMap(r => [r.start_port_id, r.end_port_id]).filter(Boolean))];
        var portsResult = await c.from('ports').select('id, port_name').in('id', portIds);
        var portMap = {};
        if (!portsResult.error && portsResult.data) {
          portsResult.data.forEach(p => { portMap[p.id] = p.port_name; });
        }
        routesResult.data.forEach(route => {
          var start = portMap[route.start_port_id] || route.start_port_id;
          var end = portMap[route.end_port_id] || route.end_port_id;
          routeNames[route.id] = start + ' → ' + end;
        });
      }
    }

    // Aggregate by route
    var byRoute = {};
    data.forEach(function(d) {
      var key = d.route_id || 'unknown';
      if (!byRoute[key]) {
        byRoute[key] = { routeId: key, routeName: routeNames[key] || key, totalPredicted: 0, count: 0, avgConfidence: 0, dates: new Set() };
      }
      byRoute[key].totalPredicted += d.predicted_passengers || 0;
      byRoute[key].count += 1;
      byRoute[key].avgConfidence += d.confidence_score || 0;
      if (d.prediction_date) byRoute[key].dates.add(d.prediction_date);
    });

    return Object.values(byRoute).map(function(r) {
      return {
        routeId: r.routeId,
        routeName: r.routeName,
        avgDailyPredicted: r.count > 0 ? Math.round(r.totalPredicted / r.dates.size) : 0,
        totalPredicted: r.totalPredicted,
        avgConfidence: r.count > 0 ? (r.avgConfidence / r.count) : 0,
        daysWithData: r.dates.size
      };
    }).sort(function(a, b) { return b.totalPredicted - a.totalPredicted; });
  }

  async function getPeakHours(routeId) {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var q = c.from('demand_predictions').select('hour_of_day, predicted_passengers');
    if (routeId) q = q.eq('route_id', routeId);
    var r = await q;
    if (r.error) throw r.error;
    var byHour = {};
    (r.data || []).forEach(function(d) {
      var h = d.hour_of_day;
      if (h === null || h === undefined) return;
      if (!byHour[h]) byHour[h] = { hour: h, total: 0, count: 0 };
      byHour[h].total += d.predicted_passengers || 0;
      byHour[h].count += 1;
    });
    return Object.values(byHour).map(function(h) {
      return { hour: h.hour, avgPredicted: h.count > 0 ? Math.round(h.total / h.count) : 0 };
    }).sort(function(a, b) { return b.avgPredicted - a.avgPredicted; });
  }

  window.bangkagoDemand = { getPredictions, getRouteDemandSummary, getPeakHours };
})();