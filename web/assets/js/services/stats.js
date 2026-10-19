/**
 * Admin statistics service for web dashboards.
 * Mirrors src/services/admin.service.ts getAdminStats()
 */
(function() {
  'use strict';
  var svc = window.bangkagoServices;

  async function getAdminStats() {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var today = new Date().toISOString().slice(0, 10);
    var weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();

    var [
      usersCount,
      bangkerosCount,
      tripsCount,
      pendingCount,
      alertsCount,
      tripsTodayResult,
      revenueAllResult,
      revenueTodayResult,
      newUsersResult,
      completedTodayResult
    ] = await Promise.all([
      c.from('users').select('*', { count: 'exact', head: true }),
      c.from('bangkeros').select('*', { count: 'exact', head: true }).eq('is_available', true).eq('is_deleted', false),
      c.from('bookings').select('*', { count: 'exact', head: true }),
      c.from('bangkeros').select('*', { count: 'exact', head: true }).eq('verification_stat', 'pending').eq('is_deleted', false),
      c.from('safety_alerts').select('*', { count: 'exact', head: true }).eq('is_resolved', false),
      c.from('bookings').select('*', { count: 'exact', head: true }).gte('created_at', today),
      c.from('bookings').select('total_price').eq('trip_stat', 'completed'),
      c.from('bookings').select('total_price').eq('trip_stat', 'completed').gte('completed_at', today),
      c.from('users').select('*', { count: 'exact', head: true }).gte('created_at', weekAgo),
      c.from('bookings').select('*', { count: 'exact', head: true }).eq('trip_stat', 'completed').gte('completed_at', today)
    ]);

    var totalRevenue = (revenueAllResult.data || []).reduce(function(sum, b) { return sum + (b.total_price || 0); }, 0);
    var revenueToday = (revenueTodayResult.data || []).reduce(function(sum, b) { return sum + (b.total_price || 0); }, 0);

    return {
      totalUsers: usersCount.count ?? 0,
      activeBangkeros: bangkerosCount.count ?? 0,
      totalTrips: tripsCount.count ?? 0,
      totalRevenue: totalRevenue,
      pendingApprovals: pendingCount.count ?? 0,
      activeAlerts: alertsCount.count ?? 0,
      tripsToday: tripsTodayResult.count ?? 0,
      revenueToday: revenueToday,
      newUsersThisWeek: newUsersResult.count ?? 0,
      completedTripsToday: completedTodayResult.count ?? 0
    };
  }

  window.bangkagoStats = { getAdminStats };
})();