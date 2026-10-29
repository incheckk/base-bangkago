import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Line, Rect } from 'react-native-svg';

import { AdminScreenHeader } from '@/components/AdminScreenHeader';
import { FilterChips } from '@/components/FilterChips';
import { ScreenContainer } from '@/components/ScreenContainer';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { getReportData, type ReportData, type ReportRange } from '@/services/admin.service';
import { colors, radii, spacing, typography } from '@/theme/tokens';

/**
 * One readable report instead of ten emoji tiles: pick a range, read the
 * money, see the shape of it, then where it came from. Every number here is
 * a query result — nothing is estimated.
 */
const RANGES: { key: ReportRange; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
  { key: '6m', label: '6 months' },
  { key: '1y', label: '1 year' },
];

const RANGE_LABEL: Record<ReportRange, string> = {
  today: 'today',
  '7d': 'last 7 days',
  '30d': 'last 30 days',
  '6m': 'last 6 months',
  '1y': 'last year',
};

const SPLIT = [
  { key: 'completed', label: 'Completed', color: colors.primary },
  { key: 'accepted', label: 'Accepted', color: colors.warning },
  { key: 'open', label: 'Open', color: colors.info },
  { key: 'pending', label: 'Pending', color: colors.textMuted },
  { key: 'cancelled', label: 'Cancelled', color: colors.danger },
];

const peso = (n: number) => `₱${Math.round(n).toLocaleString('en-PH')}`;

export default function Reports() {
  const [range, setRange] = useState<ReportRange>('7d');
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    getReportData(range)
      .then((d) => { if (alive) { setData(d); setLoading(false); } })
      .catch((e) => {
        if (!alive) return;
        setError(e?.message ?? 'Could not load this report.');
        setLoading(false);
      });
    return () => { alive = false; };
  }, [range]);

  /** The chips stay mounted while the next range loads; the body does not
   *  show the previous range's numbers under a new chip. */
  const split = useMemo(() => {
    const counts = data?.statusCounts ?? {};
    return SPLIT
      .map((s) => ({ ...s, count: counts[s.key] ?? 0 }))
      .filter((s) => s.count > 0);
  }, [data]);
  const splitTotal = split.reduce((sum, s) => sum + s.count, 0);

  return (
    <ScreenContainer padded={false}>
      <AdminScreenHeader title="Reports & Analytics" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <FilterChips filters={RANGES} active={range} onChange={(k) => setRange(k as ReportRange)} />

        {loading ? (
          <View style={styles.center}><LoadingState label="Building report…" /></View>
        ) : error ? (
          <ErrorState message={error} />
        ) : !data ? (
          <View style={styles.center}><EmptyState title="No report" message="Pick a range to see figures." /></View>
        ) : (
          <>
            <Text style={styles.caption}>
              {data.startIso === data.endIso
                ? data.endIso
                : `${data.startIso} → ${data.endIso}`}
              {'  ·  '}
              {RANGE_LABEL[data.range]}
            </Text>

            {/* ---------- headline figures ---------- */}
            <View style={styles.kpiGrid}>
              <Kpi
                label="Revenue"
                value={peso(data.revenue)}
                note={`${data.completed} completed trip${data.completed === 1 ? '' : 's'}`}
                tint={colors.primary}
              />
              <Kpi
                label="Requests"
                value={String(data.requests)}
                note={`${data.cancelled} cancelled`}
              />
              <Kpi
                label="Completion rate"
                value={data.requests > 0 ? `${Math.round((data.completed / data.requests) * 100)}%` : '—'}
                note="completed ÷ requests"
              />
              <Kpi
                label="New passengers"
                value={String(data.newUsers)}
                note="accounts created"
              />
            </View>

            {/* ---------- revenue over time ---------- */}
            <View style={styles.card}>
              <View style={styles.cardHead}>
                <Text style={styles.cardTitle}>Revenue</Text>
                <Text style={styles.cardValue}>{peso(data.revenue)}</Text>
              </View>
              <Bars values={data.buckets.map((b) => b.revenue)} color={colors.primary} />
              <AxisLabels labels={data.buckets.map((b) => b.label)} />
            </View>

            {/* ---------- trips over time ---------- */}
            <View style={styles.card}>
              <View style={styles.cardHead}>
                <Text style={styles.cardTitle}>Completed trips</Text>
                <Text style={styles.cardValue}>{data.completed}</Text>
              </View>
              <Bars values={data.buckets.map((b) => b.trips)} color={colors.info} />
              <AxisLabels labels={data.buckets.map((b) => b.label)} />
            </View>

            {/* ---------- what happened to this period's requests ---------- */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Request status</Text>
              {splitTotal === 0 ? (
                <Text style={styles.muted}>No requests were created in this period.</Text>
              ) : (
                <>
                  <View style={styles.splitBar}>
                    {split.map((s) => (
                      <View key={s.key} style={{ flex: s.count, backgroundColor: s.color }} />
                    ))}
                  </View>
                  <View style={styles.legend}>
                    {split.map((s) => (
                      <View key={s.key} style={styles.legendRow}>
                        <View style={[styles.dot, { backgroundColor: s.color }]} />
                        <Text style={styles.legendLabel}>{s.label}</Text>
                        <Text style={styles.legendValue}>
                          {s.count} · {Math.round((s.count / splitTotal) * 100)}%
                        </Text>
                      </View>
                    ))}
                  </View>
                </>
              )}
            </View>

            {/* ---------- where the money came from ---------- */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Top routes by revenue</Text>
              {data.topRoutes.length === 0 ? (
                <Text style={styles.muted}>No completed trips in this period.</Text>
              ) : (
                data.topRoutes.map((r) => (
                  <View key={r.route} style={styles.routeRow}>
                    <View style={styles.routeBody}>
                      <Text style={styles.routeName} numberOfLines={1}>{r.route}</Text>
                      <Text style={styles.routeTrips}>
                        {r.trips} trip{r.trips === 1 ? '' : 's'}
                      </Text>
                    </View>
                    <Text style={styles.routeRevenue}>{peso(r.revenue)}</Text>
                  </View>
                ))
              )}
            </View>

            {/* ---------- the network right now ---------- */}
            <Text style={styles.sectionLabel}>NETWORK NOW</Text>
            <View style={styles.networkRow}>
              <Network label="Bangkeros online" value={data.activeBangkeros} />
              <Network label="Pending approvals" value={data.pendingApprovals} />
              <Network
                label="Open alerts"
                value={data.activeAlerts}
                tint={data.activeAlerts > 0 ? colors.danger : undefined}
              />
            </View>
          </>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

function Kpi({
  label, value, note, tint,
}: { label: string; value: string; note: string; tint?: string }) {
  return (
    <View style={styles.kpi}>
      <Text style={styles.kpiLabel}>{label}</Text>
      <Text style={[styles.kpiValue, tint ? { color: tint } : null]} numberOfLines={1}>{value}</Text>
      <Text style={styles.kpiNote} numberOfLines={1}>{note}</Text>
    </View>
  );
}

/**
 * Plain bars. react-native-svg is already installed, so there is no chart
 * library and no camera work: a fixed 300-wide viewBox scales with the card.
 */
function Bars({ values, color }: { values: number[]; color: string }) {
  const W = 300;
  const H = 104;
  const max = Math.max(1, ...values);
  const slot = W / Math.max(1, values.length);
  const barW = Math.max(2, slot * 0.6);

  return (
    <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} style={styles.chart}>
      {[0.25, 0.5, 0.75, 1].map((g) => (
        <Line
          key={g}
          x1={0}
          x2={W}
          y1={H - H * g}
          y2={H - H * g}
          stroke={colors.borderSubtle}
          strokeWidth={1}
        />
      ))}
      {values.map((v, i) => {
        const h = v <= 0 ? 0 : Math.max(2, (v / max) * (H - 4));
        return (
          <Rect
            key={i}
            x={i * slot + (slot - barW) / 2}
            y={H - h}
            width={barW}
            height={h}
            rx={Math.min(3, barW / 2)}
            fill={color}
          />
        );
      })}
    </Svg>
  );
}

/** First, middle and last label only — 30 day names do not fit under a phone. */
function AxisLabels({ labels }: { labels: string[] }) {
  if (labels.length < 2) {
    return <Text style={styles.axisLabelCenter}>{labels[0] ?? ''}</Text>;
  }
  return (
    <View style={styles.axisRow}>
      <Text style={styles.axisLabel}>{labels[0]}</Text>
      <Text style={styles.axisLabel}>{labels[Math.floor(labels.length / 2)]}</Text>
      <Text style={styles.axisLabel}>{labels[labels.length - 1]}</Text>
    </View>
  );
}

function Network({ label, value, tint }: { label: string; value: number; tint?: string }) {
  return (
    <View style={styles.network}>
      <Text style={[styles.networkValue, tint ? { color: tint } : null]}>{value}</Text>
      <Text style={styles.networkLabel} numberOfLines={2}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl },
  center: { minHeight: 220 },
  caption: { ...typography.caption, color: colors.textMuted, marginTop: spacing.md },

  kpiGrid: {
    flexDirection: 'row', flexWrap: 'wrap',
    gap: spacing.md, marginTop: spacing.lg,
  },
  kpi: {
    flexBasis: '47%', flexGrow: 1, minWidth: 140,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1, borderColor: colors.borderSubtle,
    padding: spacing.lg,
  },
  kpiLabel: { ...typography.label, color: colors.textMuted },
  kpiValue: { ...typography.h1, fontSize: 26, marginTop: spacing.sm },
  kpiNote: { ...typography.caption, color: colors.textMuted, marginTop: 2, fontSize: 11 },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1, borderColor: colors.borderSubtle,
    padding: spacing.lg,
    marginTop: spacing.lg,
  },
  cardHead: {
    flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between',
    gap: spacing.md, marginBottom: spacing.md,
  },
  cardTitle: { ...typography.bodyStrong },
  cardValue: { ...typography.bodyStrong, color: colors.primary, flexShrink: 0 },
  muted: { ...typography.caption, color: colors.textMuted, marginTop: spacing.sm },

  chart: { marginTop: 2 },
  axisRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  axisLabel: { ...typography.caption, color: colors.textMuted, fontSize: 10 },
  axisLabelCenter: { ...typography.caption, color: colors.textMuted, fontSize: 10, marginTop: spacing.xs, textAlign: 'center' },

  splitBar: {
    flexDirection: 'row',
    height: 10,
    borderRadius: radii.pill,
    overflow: 'hidden',
    marginTop: spacing.md,
    backgroundColor: colors.surfaceAlt,
  },
  legend: { marginTop: spacing.md, gap: spacing.xs },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dot: { width: 8, height: 8, borderRadius: 4 },
  legendLabel: { ...typography.caption, color: colors.textSecondary, flex: 1 },
  legendValue: { ...typography.caption, color: colors.text, fontWeight: '600' },

  routeRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: 1, borderTopColor: colors.borderSubtle,
  },
  routeBody: { flex: 1, minWidth: 0 },
  routeName: { ...typography.bodyStrong, fontSize: 14 },
  routeTrips: { ...typography.caption, color: colors.textMuted, fontSize: 11, marginTop: 1 },
  routeRevenue: { ...typography.bodyStrong, color: colors.primary, flexShrink: 0 },

  sectionLabel: { ...typography.label, marginTop: spacing.xl, marginBottom: spacing.md },
  networkRow: { flexDirection: 'row', gap: spacing.md },
  network: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1, borderColor: colors.borderSubtle,
    padding: spacing.md,
  },
  networkValue: { ...typography.h2, fontSize: 22 },
  networkLabel: { ...typography.caption, color: colors.textMuted, fontSize: 11, marginTop: 2 },
});
