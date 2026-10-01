import { useCallback, useEffect, useState } from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AdminScreenHeader } from '@/components/AdminScreenHeader';
import { FilterChips } from '@/components/FilterChips';
import { PrimaryButton } from '@/components/PrimaryButton';
import { ScreenContainer } from '@/components/ScreenContainer';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { useRealtimeQuery } from '@/hooks/useRealtimeQuery';
import { friendlyError } from '@/services/booking.service';
import { docPublicUrl } from '@/services/documents.service';
import {
  type AdminDownpaymentRow,
  approveDownpayment,
  listDownpayments,
  refundDownpayment,
} from '@/services/downpayment.service';
import { colors, radii, spacing, typography } from '@/theme/tokens';

const FILTERS = [
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'refunded', label: 'Refunded' },
  { key: 'all', label: 'All' },
];

const STATUS_LABELS: Record<string, string> = {
  pending: 'Awaiting review',
  approved: 'Approved',
  refunded: 'Refunded',
};

function createdLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-PH', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Escrow review (migration 015): passengers file GCash reference +
 * screenshot when they book an island hop or boat rental; approve or
 * refund it here. Approval is bookkeeping only — nothing in the trip
 * flow waits on it — but the passenger is notified either way.
 */
export default function AdminDownpaymentsScreen() {
  const [rows, setRows] = useState<AdminDownpaymentRow[]>([]);
  const [filter, setFilter] = useState('pending');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AdminDownpaymentRow | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await listDownpayments();
      setRows(data);
      setError(null);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  // Escrow rows arrive while this screen is open (015 put downpayments
  // into the realtime publication) — no pull-to-refresh needed.
  useRealtimeQuery(load, [{ table: 'downpayments' }]);

  const visible = rows.filter((r) => filter === 'all' || r.status === filter);
  const pendingCount = rows.filter((r) => r.status === 'pending').length;

  async function doApprove(row: AdminDownpaymentRow) {
    if (busyId) return;
    setBusyId(row.downpaymentId);
    setActionError(null);
    try {
      await approveDownpayment(row);
      setDetail(null);
      await load();
    } catch (e) {
      setActionError(friendlyError(e));
    }
    setBusyId(null);
  }

  async function doRefund(row: AdminDownpaymentRow) {
    if (busyId) return;
    setBusyId(row.downpaymentId);
    setActionError(null);
    try {
      await refundDownpayment(row);
      setDetail(null);
      await load();
    } catch (e) {
      setActionError(friendlyError(e));
    }
    setBusyId(null);
  }

  const proofUrl = detail ? docPublicUrl(detail.proofUrl) : null;

  return (
    <ScreenContainer padded={false}>
      <AdminScreenHeader
        eyebrow="PAYMENTS"
        title="Downpayments"
        subtitle={
          pendingCount > 0
            ? `${pendingCount} awaiting review`
            : `${rows.length} total`
        }
      />
      <FilterChips filters={FILTERS} active={filter} onChange={setFilter} />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {!!actionError && (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>{actionError}</Text>
          </View>
        )}

        {loading ? (
          <LoadingState label="Loading downpayments…" />
        ) : error ? (
          <ErrorState message={error} onRetry={() => { setLoading(true); void load(); }} />
        ) : visible.length === 0 ? (
          <EmptyState
            icon="🧾"
            title="Nothing here"
            message={
              filter === 'pending'
                ? 'No downpayments are waiting for review.'
                : `No ${filter} downpayments yet.`
            }
          />
        ) : (
          visible.map((row) => (
            <Pressable
              key={row.downpaymentId}
              onPress={() => setDetail(row)}
              style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
              accessibilityRole="button"
              accessibilityLabel={`Downpayment ${row.amount} pesos, ${row.status}`}
            >
              <View style={styles.cardTop}>
                <Text style={styles.cardWho} numberOfLines={1}>
                  {row.payerName ?? 'Passenger'} · {row.label}
                </Text>
                <Text style={styles.cardAmount}>₱{row.amount}</Text>
              </View>
              <Text style={styles.cardMeta} numberOfLines={1}>
                {row.serviceLabel} · {createdLabel(row.createdAt)}
              </Text>
              <View style={styles.cardBottom}>
                <Text style={styles.cardRef} numberOfLines={1}>
                  GCash ref: {row.referenceNum || '—'}
                </Text>
                <View
                  style={[
                    styles.statusChip,
                    row.status === 'approved' && styles.statusApproved,
                    row.status === 'refunded' && styles.statusRefunded,
                  ]}
                >
                  <Text
                    style={[
                      styles.statusText,
                      row.status === 'approved' && styles.statusTextApproved,
                      row.status === 'refunded' && styles.statusTextRefunded,
                    ]}
                  >
                    {STATUS_LABELS[row.status] ?? row.status}
                  </Text>
                </View>
              </View>
            </Pressable>
          ))
        )}
      </ScrollView>

      <Modal
        visible={!!detail}
        transparent
        animationType="fade"
        onRequestClose={() => setDetail(null)}
      >
        <View style={styles.modalBg}>
          <Pressable
            onPress={() => setDetail(null)}
            style={styles.modalClose}
            accessibilityRole="button"
            accessibilityLabel="Close"
          >
            <Text style={styles.modalCloseText}>✕</Text>
          </Pressable>

          <ScrollView contentContainerStyle={styles.modalBody}>
            <Text style={styles.modalTitle}>
              ₱{detail?.amount} · {STATUS_LABELS[detail?.status ?? ''] ?? detail?.status}
            </Text>
            <Text style={styles.modalSub}>
              {detail?.payerName ?? 'Passenger'} · {detail?.label}
            </Text>
            <Text style={styles.modalSub}>{detail?.serviceLabel}</Text>
            <Text style={styles.modalSub}>
              GCash ref: {detail?.referenceNum || '—'} · filed {detail ? createdLabel(detail.createdAt) : ''}
            </Text>

            {proofUrl ? (
              <Image source={{ uri: proofUrl }} style={styles.modalImg} resizeMode="contain" />
            ) : (
              <View style={styles.modalImgMissing}>
                <Text style={styles.modalImgMissingText}>Proof screenshot unavailable</Text>
              </View>
            )}

            {detail?.status === 'pending' ? (
              <>
                <PrimaryButton
                  label="Approve downpayment"
                  onPress={() => void doApprove(detail)}
                  loading={busyId === detail.downpaymentId}
                  disabled={busyId !== null}
                  style={styles.modalBtn}
                />
                <PrimaryButton
                  label="Mark as refunded"
                  variant="secondary"
                  onPress={() => void doRefund(detail)}
                  loading={busyId === detail.downpaymentId}
                  disabled={busyId !== null}
                  style={styles.modalBtn}
                />
              </>
            ) : (
              <Text style={styles.modalDone}>
                Reviewed {detail?.reviewedAt ? createdLabel(detail.reviewedAt) : ''} — the
                passenger was notified.
              </Text>
            )}
          </ScrollView>
        </View>
      </Modal>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.huge, paddingTop: spacing.sm },

  banner: {
    backgroundColor: colors.dangerTint,
    borderColor: colors.danger,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  bannerText: { flexShrink: 1, color: colors.danger, fontSize: 13, lineHeight: 18 },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  cardPressed: { borderColor: colors.primary, backgroundColor: colors.surfaceAlt },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  cardWho: { flex: 1, flexShrink: 1, color: colors.text, fontSize: 14, fontWeight: '700' },
  cardAmount: { flexShrink: 1, color: colors.primary, fontSize: 17, fontWeight: '700' },
  cardMeta: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  cardBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  cardRef: { flex: 1, ...typography.caption, color: colors.textSecondary, fontSize: 11 },

  statusChip: {
    backgroundColor: colors.warningTint,
    paddingHorizontal: spacing.md,
    paddingVertical: 3,
    borderRadius: radii.pill,
  },
  statusApproved: { backgroundColor: colors.primaryTint },
  statusRefunded: { backgroundColor: colors.neutralTint },
  statusText: { fontSize: 10, fontWeight: '700', color: colors.warning, textTransform: 'uppercase' },
  statusTextApproved: { color: colors.primary },
  statusTextRefunded: { color: colors.textSecondary },

  modalBg: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    paddingTop: spacing.huge,
  },
  modalClose: {
    position: 'absolute',
    top: spacing.xl,
    right: spacing.xl,
    width: 44,
    height: 44,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  modalCloseText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  modalBody: { paddingHorizontal: spacing.xl, paddingBottom: spacing.huge, alignItems: 'stretch' },
  modalTitle: { ...typography.h2, color: '#fff', marginBottom: spacing.sm, marginRight: 56 },
  modalSub: { ...typography.caption, color: 'rgba(255,255,255,0.85)', lineHeight: 18 },
  modalImg: {
    width: '100%',
    height: 320,
    marginTop: spacing.lg,
    borderRadius: radii.md,
    backgroundColor: '#fff',
  },
  modalImgMissing: {
    height: 120,
    marginTop: spacing.lg,
    borderRadius: radii.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(255,255,255,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalImgMissingText: { color: 'rgba(255,255,255,0.7)', fontSize: 13 },
  modalBtn: { marginTop: spacing.lg },
  modalDone: {
    ...typography.caption,
    color: 'rgba(255,255,255,0.85)',
    textAlign: 'center',
    marginTop: spacing.xl,
    lineHeight: 18,
  },
});
