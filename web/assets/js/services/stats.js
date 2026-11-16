/**
 * Admin statistics service for web dashboards.
 * Mirrors src/services/admin.service.ts getAdminStats()
 */
(function() {
  'use strict';
  var svc = window.bangkagoServices;

  async function getAdminStats() {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
    var todayStart = new Date(today + 'T00:00:00+08:00');
    var tomorrowStart = new Date(todayStart.getTime() + 86400000);
    var startIso = todayStart.toISOString();
    var endIso = tomorrowStart.toISOString();
    var weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    var todayTripsFilter = 'and(depart_time.gte.' + startIso + ',depart_time.lt.' + endIso + '),and(created_at.gte.' + startIso + ',created_at.lt.' + endIso + ')';

    var [
      usersCount,
      bangkerosCount,
      tripsCount,
      pendingCount,
      alertsCount,
      todayTripsResult,
      revenueAllResult,
      revenueTodayResult,
      newUsersResult
    ] = await Promise.all([
      c.from('users').select('*', { count: 'exact', head: true }),
      c.from('bangkeros').select('*', { count: 'exact', head: true }).eq('is_available', true).eq('is_deleted', false),
      c.from('bookings').select('*', { count: 'exact', head: true }),
      c.from('bangkeros').select('*', { count: 'exact', head: true }).eq('verification_stat', 'pending').eq('is_deleted', false),
      c.from('safety_alerts').select('*', { count: 'exact', head: true }).eq('is_resolved', false),
      c.from('bookings').select('trip_stat').or(todayTripsFilter),
      c.from('bookings').select('total_price').eq('trip_stat', 'completed'),
      c.from('bookings').select('total_price').eq('trip_stat', 'completed').gte('completed_at', startIso),
      c.from('users').select('*', { count: 'exact', head: true }).gte('created_at', weekAgo)
    ]);

    var totalRevenue = (revenueAllResult.data || []).reduce(function(sum, b) { return sum + (b.total_price || 0); }, 0);
    var revenueToday = (revenueTodayResult.data || []).reduce(function(sum, b) { return sum + (b.total_price || 0); }, 0);
    var todayTrips = (todayTripsResult.data || []).filter(function(b) { return b.trip_stat !== 'cancelled'; });
    var completedToday = todayTrips.filter(function(b) { return b.trip_stat === 'completed'; }).length;
    var activeToday = todayTrips.filter(function(b) { return b.trip_stat === 'open' || b.trip_stat === 'accepted'; }).length;

    return {
      totalUsers: usersCount.count ?? 0,
      activeBangkeros: bangkerosCount.count ?? 0,
      totalTrips: tripsCount.count ?? 0,
      totalRevenue: totalRevenue,
      pendingApprovals: pendingCount.count ?? 0,
      activeAlerts: alertsCount.count ?? 0,
      tripsToday: todayTrips.length,
      revenueToday: revenueToday,
      newUsersThisWeek: newUsersResult.count ?? 0,
      completedTripsToday: completedToday,
      activeTripsToday: activeToday
    };
  }

  var REPORT_RANGES = {
    today: 0,
    '7d': 6,
    '30d': 29,
    '6m': 179,
    '1y': 364
  };
  var MONTH_RANGES = { '6m': true, '1y': true };
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var REPORT_PAGE_SIZE = 1000;

  function manilaDayIso(date) {
    return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
  }

  function dayStart(dayIso) {
    return new Date(dayIso + 'T00:00:00+08:00');
  }

  function addDays(dayIso, amount) {
    return manilaDayIso(new Date(dayStart(dayIso).getTime() + amount * 86400000));
  }

  function timestampDay(value) {
    if (!value) return null;
    var date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : manilaDayIso(date);
  }

  function makeBuckets(range, startIso, endIso) {
    var buckets = [];
    if (MONTH_RANGES[range]) {
      var start = startIso.split('-').map(Number);
      var end = endIso.split('-').map(Number);
      var year = start[0];
      var month = start[1];
      while (year < end[0] || (year === end[0] && month <= end[1])) {
        buckets.push({
          key: year + '-' + String(month).padStart(2, '0'),
          label: MONTHS[month - 1] + ' ' + String(year).slice(-2),
          revenue: 0,
          trips: 0
        });
        month += 1;
        if (month > 12) { month = 1; year += 1; }
      }
      return buckets;
    }

    for (var day = startIso; day <= endIso; day = addDays(day, 1)) {
      buckets.push({
        key: day,
        label: dayStart(day).toLocaleDateString('en-PH', {
          month: 'short',
          day: 'numeric',
          timeZone: 'Asia/Manila'
        }),
        revenue: 0,
        trips: 0
      });
    }
    return buckets;
  }

  async function fetchReportBookings(client, startTs, endTs) {
    var rows = [];
    for (var from = 0; ; from += REPORT_PAGE_SIZE) {
      var result = await client.from('bookings')
        .select('trip_stat, total_price, created_at, completed_at, from_port_name, to_port_name')
        .or('and(created_at.gte.' + startTs + ',created_at.lt.' + endTs + '),and(completed_at.gte.' + startTs + ',completed_at.lt.' + endTs + ')')
        .order('id', { ascending: true })
        .range(from, from + REPORT_PAGE_SIZE - 1);
      if (result.error) throw result.error;
      var page = result.data || [];
      rows = rows.concat(page);
      if (page.length < REPORT_PAGE_SIZE) return rows;
    }
  }

  async function getReportData(range) {
    var client = svc.getClient();
    if (!client) throw new Error('No client');
    if (!Object.prototype.hasOwnProperty.call(REPORT_RANGES, range)) {
      throw new Error('Invalid report range');
    }

    var endIso = manilaDayIso(new Date());
    var startIso = addDays(endIso, -REPORT_RANGES[range]);
    var endExclusiveIso = addDays(endIso, 1);
    var startTs = dayStart(startIso).toISOString();
    var endTs = dayStart(endExclusiveIso).toISOString();

    var results = await Promise.all([
      fetchReportBookings(client, startTs, endTs),
      client.from('users').select('*', { count: 'exact', head: true })
        .eq('user_role', 'passenger').gte('created_at', startTs).lt('created_at', endTs),
      client.from('bangkeros').select('*', { count: 'exact', head: true })
        .eq('is_available', true).eq('is_deleted', false),
      client.from('bangkeros').select('*', { count: 'exact', head: true })
        .eq('verification_stat', 'pending').eq('is_deleted', false),
      client.from('safety_alerts').select('*', { count: 'exact', head: true }).eq('is_resolved', false)
    ]);
    var bookings = results[0];
    var users = results[1];
    var bangkeros = results[2];
    var pending = results[3];
    var alerts = results[4];
    [users, bangkeros, pending, alerts].forEach(function(result) {
      if (result.error) throw result.error;
    });

    var buckets = makeBuckets(range, startIso, endIso);
    var bucketByKey = new Map(buckets.map(function(bucket) { return [bucket.key, bucket]; }));
    var monthMode = Boolean(MONTH_RANGES[range]);
    var revenue = 0;
    var completed = 0;
    var completedRequests = 0;
    var requests = 0;
    var cancelled = 0;
    var statusCounts = {};
    var routes = new Map();

    bookings.forEach(function(row) {
      var createdDay = timestampDay(row.created_at);
      var completedDay = timestampDay(row.completed_at);

      if (createdDay && createdDay >= startIso && createdDay <= endIso) {
        requests += 1;
        var status = row.trip_stat || 'unknown';
        statusCounts[status] = (statusCounts[status] || 0) + 1;
        if (status === 'cancelled') cancelled += 1;
        if (status === 'completed') completedRequests += 1;
      }

      if (row.trip_stat !== 'completed' || !completedDay || completedDay < startIso || completedDay > endIso) return;
      var price = Number(row.total_price) || 0;
      completed += 1;
      revenue += price;

      var bucket = bucketByKey.get(monthMode ? completedDay.slice(0, 7) : completedDay);
      if (bucket) {
        bucket.revenue += price;
        bucket.trips += 1;
      }

      var route = (row.from_port_name || '—') + ' → ' + (row.to_port_name || '—');
      var entry = routes.get(route) || { route: route, trips: 0, revenue: 0 };
      entry.trips += 1;
      entry.revenue += price;
      routes.set(route, entry);
    });

    return {
      range: range,
      startIso: startIso,
      endIso: endIso,
      revenue: revenue,
      completed: completed,
      completedRequests: completedRequests,
      requests: requests,
      cancelled: cancelled,
      newUsers: users.count || 0,
      activeBangkeros: bangkeros.count || 0,
      pendingApprovals: pending.count || 0,
      activeAlerts: alerts.count || 0,
      statusCounts: statusCounts,
      buckets: buckets,
      topRoutes: Array.from(routes.values()).sort(function(a, b) { return b.revenue - a.revenue; }).slice(0, 5)
    };
  }

  window.bangkagoStats = { getAdminStats: getAdminStats, getReportData: getReportData };
})();