import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { BangkeroScreenHeader } from '@/components/BangkeroScreenHeader';
import { ScreenContainer } from '@/components/ScreenContainer';
import { StarRating } from '@/components/StarRating';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { useAuth } from '@/hooks/useAuth';
import { useRefetchOnFocus } from '@/hooks/useRealtimeQuery';
import {
  getAverageRating, getEffectiveRating, getRatingsByBangkero,
} from '@/services/rating.service';
import { supabase } from '@/services/supabase';
import { colors, radii, spacing, typography } from '@/theme/tokens';
import type { RatingDoc } from '@/types/models';

/**
 * What passengers said about you: the average the accept gate uses
 * (010 floors it at 3.0★), the effective number after penalties, and
 * every comment — previously only a hidden number on the profile.
 */
export default function BangkeroRatingsScreen() {
  const { user } = useAuth();
  const uid = user?.id ?? null;

  const [rows, setRows] = useState<RatingDoc[]>([]);
  const [avg, setAvg] = useState<number | null>(null);
  const [effective, setEffective] = useState<number | null>(null);
  const [penalty, setPenalty] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!uid) {
      setLoading(false);
      return;
    }
    try {
      const [list, average, eff, bangkeroRow] = await Promise.all([
        getRatingsByBangkero(uid),
        getAverageRating(uid),
        getEffectiveRating(uid),
        supabase.from('bangkeros').select('rating_penalty').eq('id', uid).maybeSingle(),
      ]);
      setRows(list);
      setAvg(average);
      setEffective(eff);
      setPenalty(Number(bangkeroRow.data?.rating_penalty ?? 0) || 0);
      setLoading(false);
      setError(null);
    } catch (e) {
      setError((e as Error).message || 'Could not load your ratings.');
      setLoading(false);
    }
  }, [uid]);

  useEffect(() => {
    void load();
  }, [load]);
  useRefetchOnFocus(load);

  if (loading) {
    return (
      <ScreenContainer>
        <BangkeroScreenHeader title="My Ratings" showDrawer={false} />
        <LoadingState label="Loading your ratings…" />
      </ScreenContainer>
    );
  }

  if (error) {
    return (
      <ScreenContainer>
        <BangkeroScreenHeader title="My Ratings" showDrawer={false} />
        <ErrorState message={error} />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer padded={false}>
      <BangkeroScreenHeader title="My Ratings" showDrawer={false} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Summary */}
        <View style={styles.summary}>
          <Text style={styles.summaryAvg}>
            {avg === null ? '…' : avg > 0 ? avg.toFixed(1) : '—'}
          </Text>
          <StarRating rating={avg ?? 0} size={20} />
          <Text style={styles.summaryCount}>
            {rows.length === 0
              ? 'No ratings yet'
              : `${rows.length} rating${rows.length === 1 ? '' : 's'} from passengers`}
          </Text>
          {penalty > 0 && effective !== null && avg !== null && avg !== effective && (
            <Text style={styles.effectiveNote}>
              Effective rating {effective.toFixed(1)} ★ after penalties — this is what the accept gate uses.
            </Text>
          )}
        </View>

        {/* Comments */}
        {rows.length === 0 ? (
          <EmptyState
            icon="⭐"
            title="No ratings yet"
            message="Ratings from completed trips will appear here with passenger comments."
          />
        ) : (
          <View style={styles.list}>
            {rows.map((r) => (
              <View key={r.ratingId} style={styles.card}>
                <View style={styles.cardTop}>
                  <StarRating rating={r.score} size={16} />
                  <Text style={styles.cardDate}>{formatDate(r.createdAt)}</Text>
                </View>
                <Text style={styles.cardComment}>
                  {r.comment?.trim() ? r.comment : 'No comment left.'}
                </Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-PH', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl, flexGrow: 1 },
  summary: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.xl,
    alignItems: 'center',
    marginTop: spacing.lg,
    gap: spacing.xs,
  },
  summaryAvg: { ...typography.display, color: colors.primary },
  summaryCount: { color: colors.textSecondary, fontSize: 13, marginTop: spacing.xs },
  effectiveNote: {
    color: colors.textMuted,
    fontSize: 12,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  list: { gap: spacing.md, marginTop: spacing.lg },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardDate: { color: colors.textMuted, fontSize: 12 },
  cardComment: { color: colors.text, fontSize: 14, lineHeight: 20 },
});
