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

  window.bangkagoStats = { getAdminStats };
})();