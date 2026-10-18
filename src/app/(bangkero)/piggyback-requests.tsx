import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { BangkeroScreenHeader } from '@/components/BangkeroScreenHeader';
import { PrimaryButton } from '@/components/PrimaryButton';
import { ScreenContainer } from '@/components/ScreenContainer';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { useAuth } from '@/hooks/useAuth';
import { usePiggybackRequests } from '@/hooks/usePiggybackRequests';
import {
  approvePiggyback,
  rejectPiggyback,
} from '@/services/parcel-piggyback.service';
import { colors, radii, spacing, typography } from '@/theme/tokens';
import type { ParcelDoc } from '@/types/models';

function deadlineLabel(deadlineIso: string | null, now: number): string {
  if (!deadlineIso) return 'No deadline set';
  const ms = new Date(deadlineIso).getTime() - now;
  if (!Number.isFinite(ms) || ms <= 0) return 'Overdue — will time out';
  const mins = Math.ceil(ms / 60000);
  return `Respond in ${mins} min`;
}

function RequestCard({
  parcel,
  now,
  busy,
  onDone,
  onError,
}: {
  parcel: ParcelDoc;
  now: number;
  busy: boolean;
  onDone: () => void;
  onError: (message: string) => void;
}) {
  const [acting, setActing] = useState(false);
  const disabled = busy || acting;

  async function act(kind: 'approve' | 'reject') {
    if (disabled) return;
    setActing(true);
    try {
      if (kind === 'approve') {
        await approvePiggyback(parcel.parcelId);
      } else {
        await rejectPiggyback(parcel.parcelId);
      }
      onDone();
    } catch (e) {
      onError(e instanceof Error ? e.message : `Failed to ${kind} request`);
    } finally {
      setActing(false);
    }
  }

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.receiver} numberOfLines={1}>
          {parcel.receiverName}
        </Text>
        <Text style={[styles.deadline, styles.deadlineUrgent]} numberOfLines={1}>
          {deadlineLabel(parcel.approvalDeadlineAt, now)}
        </Text>
      </View>
      {!!parcel.receiverContact && (
        <Text style={styles.meta} numberOfLines={1}>
          {parcel.receiverContact}
        </Text>
      )}
      <Text style={styles.meta} numberOfLines={1}>
        {parcel.originIsland ?? '—'} → {parcel.destinationIsland ?? '—'}
        {parcel.totalWeightKg !== null ? ` · ${parcel.totalWeightKg} kg` : ''}
      </Text>
      {parcel.quotedFare !== null && (
        <Text style={styles.fare} numberOfLines={1}>
          ₱{parcel.quotedFare}
        </Text>
      )}
      <View style={styles.actions}>
        <View style={styles.actionBtn}>
          <PrimaryButton
            label="Reject"
            variant="danger"
            onPress={() => void act('reject')}
            disabled={disabled}
            loading={acting}
          />
        </View>
        <View style={styles.actionBtn}>
          <PrimaryButton
            label="Accept"
            onPress={() => void act('approve')}
            disabled={disabled}
            loading={acting}
          />
        </View>
      </View>
    </View>
  );
}

export default function PiggybackRequests() {
  const { user } = useAuth();
  const uid = user?.id ?? null;
  const { data, loading, error, refresh } = usePiggybackRequests(uid);
  const [actionError, setActionError] = useState<string | null>(null);

  // Deadline countdown ticks without refetching — realtime + refresh
  // carry the actual row changes.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);

  return (
    <ScreenContainer padded={false}>
      <BangkeroScreenHeader
        title="Piggyback Requests"
        subtitle="Parcels asking to ride your trips"
      />
      {loading ? (
        <LoadingState label="Loading requests…" />
      ) : error ? (
        <ErrorState message={error} onRetry={() => void refresh()} />
      ) : data.length === 0 ? (
        <EmptyState
          title="No pending piggyback requests"
          message="New parcel requests for your trips will appear here."
        />
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          {!!actionError && (
            <Text style={styles.actionError}>{actionError}</Text>
          )}
          {data.map((parcel) => (
            <RequestCard
              key={parcel.parcelId}
              parcel={parcel}
              now={now}
              busy={false}
              onDone={() => void refresh()}
              onError={setActionError}
            />
          ))}
        </ScrollView>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  receiver: { flexShrink: 1, ...typography.label, marginBottom: 0 },
  deadline: { ...typography.caption },
  deadlineUrgent: { color: colors.warning, fontWeight: '700' },
  meta: { ...typography.caption, marginBottom: spacing.xxs },
  fare: { color: colors.primary, fontSize: 16, fontWeight: '700' },
  actions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
  actionBtn: { flex: 1 },
  actionError: { color: colors.danger, marginBottom: spacing.md },
});
