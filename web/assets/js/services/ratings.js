/**
 * Ratings service for the admin Ratings page.
 *
 * Effective-rating rule v2 (migration 036) — the SQL RPC
 * `bangkero_effective_rating` is the source of truth (5★ prior of
 * weight 4, minus penalty, plus recovery stars, 2-day recovery tick).
 * This service calls the RPC per bangkero and falls back to a local
 * mirror of the same formula if the RPC is missing.
 */
(function() {
  'use strict';
  var svc = window.bangkagoServices;

  /** Floor from 036: effective <= 1.0★ locks the bangkero out. */
  var LOCK_FLOOR = 1.0;
  var PRIOR_COUNT = 4;

  function mapRating(row) {
    return {
      ratingId: row.id,
      score: row.score,
      comment: row.comment,
      createdAt: row.created_at,
      bookingId: row.booking_id,
      userId: row.user_id,
      bangkeroId: row.bangkero_id
    };
  }

  /** All ratings, newest first (ratings_select_all RLS). */
  async function listRatings() {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var r = await c.from('ratings').select('*').order('created_at', { ascending: false });
    if (r.error) throw r.error;
    return (r.data || []).map(mapRating);
  }

  /** Display name for each rater id — one query, no per-row lookups. */
  async function getRaterNames(userIds) {
    var ids = (userIds || []).filter(Boolean);
    if (!ids.length) return {};
    var c = svc.getClient(); if (!c) return {};
    var r = await c.from('users').select('id, first_name, last_name').in('id', ids);
    if (r.error) throw r.error;
    var out = {};
    (r.data || []).forEach(function(u) {
      out[u.id] = [u.first_name, u.last_name].filter(Boolean).join(' ') || 'Passenger';
    });
    return out;
  }

  /** Local mirror of the 036 formula — only used when the RPC is unavailable. */
  function localEffective(sum, count, penalty, recovery) {
    return (sum + 5 * PRIOR_COUNT) / (count + PRIOR_COUNT) - penalty + recovery;
  }

  /**
   * One summary row per bangkero: raw average, count, penalty,
   * recovery stars and the effective number the accept gate uses.
   * Pass the ratings array when the page already fetched it —
   * the old signature refetched the whole table a second time.
   */
  async function listSummaries(preloadedRatings) {
    var c = svc.getClient(); if (!c) throw new Error('No client');

    var ratings = preloadedRatings || await listRatings();

    var bRes = await c.from('bangkeros').select('*').order('display_name');
    if (bRes.error) throw bRes.error;
    var bangkeros = bRes.data || [];

    var groups = {};
    ratings.forEach(function(r) {
      var g = groups[r.bangkeroId] || (groups[r.bangkeroId] = { sum: 0, count: 0 });
      g.sum += r.score;
      g.count += 1;
    });

    var summaries = bangkeros.map(function(b) {
      var g = groups[b.id] || { sum: 0, count: 0 };
      var penalty = Number(b.rating_penalty || 0);
      var recovery = Number(b.rating_recovery_stars || 0);
      var avg = g.count ? g.sum / g.count : 0;
      return {
        bangkeroId: b.id,
        displayName: b.display_name || 'Unnamed',
        verificationStat: b.verification_stat,
        count: g.count,
        avg: avg,
        penalty: penalty,
        recovery: recovery,
        effective: localEffective(g.sum, g.count, penalty, recovery)
      };
    });

    // The gate number must come from the DB formula when it exists —
    // it also runs the 2-day recovery tick as a side effect.
    await Promise.all(summaries.map(async function(s) {
      try {
        var r = await c.rpc('bangkero_effective_rating', { p_bangkero: s.bangkeroId });
        if (!r.error && r.data !== null && r.data !== undefined) {
          s.effective = Number(r.data);
        }
      } catch (e) { /* RPC missing pre-036: keep the local mirror */ }
    }));

    summaries.forEach(function(s) {
      s.locked = s.effective <= LOCK_FLOOR;
    });
    summaries.sort(function(a, b) { return b.effective - a.effective; });
    return summaries;
  }

  /**
   * Admin: set a bangkero's penalty / recovery stars (migration 038
   * RPC — admin-only server-side; the audit log records it). Returns
   * the new effective rating straight from the SQL formula.
   */
  async function adjustRating(bangkeroId, penalty, recovery) {
    var c = svc.getClient(); if (!c) throw new Error('No client');
    var r = await c.rpc('admin_set_bangkero_rating', {
      p_bangkero: bangkeroId,
      p_penalty: penalty,
      p_recovery: recovery
    });
    if (r.error) throw r.error;
    return Number(r.data);
  }

  /**
   * Raw smoothed average (5★ prior of weight 4) for a summary row —
   * the target slider back-solves from this. Unrated = 5.0.
   */
  function smoothedBase(summary) {
    return (summary.avg * summary.count + 5 * 4) / (summary.count + 4);
  }

  window.bangkagoRatings = {
    LOCK_FLOOR: LOCK_FLOOR,
    listRatings: listRatings,
    listSummaries: listSummaries,
    getRaterNames: getRaterNames,
    adjustRating: adjustRating,
    smoothedBase: smoothedBase
  };
})();
