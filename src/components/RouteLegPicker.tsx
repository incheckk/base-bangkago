import { useState } from 'react';
import { Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { Icon } from './Icon';
import { MapContainer } from './MapContainer';
import { PortPickerSheet } from './PortSelect';
import type { PortDoc } from '../types/models';
import { colors, elevation, radii, spacing, touchTarget, typography } from '../theme/tokens';

/**
 * The Book a Ride route card: a small map, one tap target per leg, and a
 * swap button. Book Delivery used two plain dropdowns for the same decision,
 * so both booking forms now share this — same look, same blocked-port
 * explanations, same one-sheet picker.
 */
interface Props {
  ports: PortDoc[];
  fromId: string | null;
  toId: string | null;
  onChange: (leg: 'from' | 'to', portId: string) => void;
  onSwap?: () => void;
  locked?: boolean;
  fromSheetTitle?: string;
  toSheetTitle?: string;
  /** Per-leg rule: a sentence explaining why a port cannot be chosen. */
  isDisabled?: (portId: string, leg: 'from' | 'to') => string | null;
  /** Narrow the destination list (Book a Ride hides same-island ports). */
  destinationPorts?: (from: PortDoc) => PortDoc[];
  style?: ViewStyle;
}

export function RouteLegPicker({
  ports,
  fromId,
  toId,
  onChange,
  onSwap,
  locked = false,
  fromSheetTitle = 'Departure',
  toSheetTitle = 'Destination',
  isDisabled,
  destinationPorts,
  style,
}: Props) {
  /** Which leg's port list is open. One sheet serves both. */
  const [picking, setPicking] = useState<'from' | 'to' | null>(null);
  /** The passenger reached for a destination before picking a departure. */
  const [needsDeparture, setNeedsDeparture] = useState(false);

  const fromPort = ports.find((p) => p.portId === fromId);
  const toPort = ports.find((p) => p.portId === toId);

  return (
    <View style={[styles.routeCard, style]}>
      <View style={styles.mapWrap}>
        {/* Inside a ScrollView, so one-finger drag stays with the page.
            Pinch and the zoom buttons still work. */}
        <MapContainer
          ports={ports}
          fromPortId={fromId}
          toPortId={toId}
          height={150}
          draggable={false}
        />
      </View>

      <View style={styles.legs}>
        <View style={styles.legRail}>
          <View style={[styles.legDot, !!fromId && styles.legDotOn]} />
          <View style={styles.legLine} />
          <View style={[styles.legDot, styles.legDotEnd, !!toId && styles.legDotOn]} />
        </View>

        <View style={styles.legBody}>
          <Pressable
            onPress={() => setPicking('from')}
            disabled={locked}
            accessibilityRole="button"
            accessibilityLabel={`Departure: ${fromPort?.portName ?? 'not selected'}`}
            style={({ pressed }) => [styles.legRow, pressed && !locked && styles.legRowPressed]}
          >
            <View style={styles.legText}>
              <Text style={styles.legLabel}>DEPARTURE</Text>
              <Text style={[styles.legValue, !fromPort && styles.legValueEmpty]} numberOfLines={1}>
                {fromPort?.portName ?? 'Select a departure port'}
              </Text>
            </View>
            {!locked && <Icon name="expand" size={18} color={colors.textMuted} />}
          </Pressable>

          <View style={styles.legDivider} />

          <Pressable
            onPress={() => {
              // Tapping "where are you going" first sends the passenger
              // to the departure picker — the destination list depends on it.
              if (!fromId) {
                setNeedsDeparture(true);
                setPicking('from');
                return;
              }
              setPicking('to');
            }}
            disabled={locked}
            accessibilityRole="button"
            accessibilityLabel={`Destination: ${toPort?.portName ?? 'not selected'}`}
            style={({ pressed }) => [
              styles.legRow,
              !fromId && !locked && styles.legRowNeedsFrom,
              pressed && !locked && styles.legRowPressed,
            ]}
          >
            <View style={styles.legText}>
              <Text style={styles.legLabel}>DESTINATION</Text>
              <Text style={[styles.legValue, !toPort && styles.legValueEmpty]} numberOfLines={1}>
                {toPort?.portName ?? (fromId ? 'Select a destination' : 'Pick a departure first')}
              </Text>
            </View>
            {!locked && <Icon name="expand" size={18} color={colors.textMuted} />}
          </Pressable>
          {!locked && !fromId && (
            <Text style={styles.legHint}>
              {needsDeparture
                ? 'Choose your departure port first — destinations depend on it.'
                : 'Pick a departure port to unlock destinations.'}
            </Text>
          )}
        </View>

        <Pressable
          onPress={onSwap}
          disabled={locked || !onSwap || (!fromId && !toId)}
          accessibilityRole="button"
          accessibilityLabel="Swap departure and destination"
          style={({ pressed }) => [
            styles.swapBtn,
            (locked || !onSwap || (!fromId && !toId)) && styles.swapBtnOff,
            pressed && styles.swapBtnPressed,
          ]}
        >
          <Icon name="route" size={18} color={colors.primary} />
        </Pressable>
      </View>

      {/* One sheet, both legs. A blocked port says why rather than just
          greying out — "no route from Marigondon" is actionable, a dimmed
          row is a dead end you have to guess at. */}
      <PortPickerSheet
        visible={picking !== null}
        onClose={() => setPicking(null)}
        title={picking === 'to' ? toSheetTitle : fromSheetTitle}
        ports={
          picking === 'to' && fromPort && destinationPorts
            ? destinationPorts(fromPort)
            : ports
        }
        selected={picking === 'to' ? toId : fromId}
        isDisabled={(id) => {
          if (picking === 'to') {
            if (id === fromId) return 'Same as departure';
            return isDisabled?.(id, 'to') ?? null;
          }
          return id === toId ? 'Same as destination' : isDisabled?.(id, 'from') ?? null;
        }}
        onSelect={(id) => {
          if (picking === 'to') {
            onChange('to', id);
          } else {
            onChange('from', id);
            setNeedsDeparture(false);
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  routeCard: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.xl,
    backgroundColor: colors.surface,
    borderRadius: radii.xl,
    borderWidth: 1, borderColor: colors.borderSubtle,
    overflow: 'hidden',
    ...elevation.e2,
  },
  mapWrap: { borderBottomWidth: 1, borderBottomColor: colors.borderSubtle },

  legs: { flexDirection: 'row', alignItems: 'center', padding: spacing.lg, gap: spacing.md },
  legRail: { alignItems: 'center', paddingVertical: spacing.xs },
  legDot: {
    width: 10, height: 10, borderRadius: radii.pill,
    borderWidth: 2, borderColor: colors.textMuted, backgroundColor: 'transparent',
  },
  legDotOn: { borderColor: colors.primary, backgroundColor: colors.primary },
  legDotEnd: { borderRadius: radii.xs },
  legLine: { width: 2, flex: 1, minHeight: 28, backgroundColor: colors.border, marginVertical: spacing.xxs },
  legBody: { flex: 1 },
  // Each leg is a tap target now, so it has to clear the 44pt minimum on its
  // own rather than relying on the card's padding.
  legRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    minHeight: touchTarget,
  },
  legRowPressed: { opacity: 0.6 },
  // No departure picked yet — the destination row points at the top field.
  legRowNeedsFrom: {
    borderWidth: 1, borderColor: colors.primary, borderRadius: radii.sm,
    backgroundColor: colors.primaryTint, paddingHorizontal: spacing.sm,
  },
  legHint: { ...typography.caption, color: colors.primary, marginTop: spacing.xs },
  legText: { flex: 1, minWidth: 0 },
  legLabel: { ...typography.label, marginBottom: spacing.xxs },
  legValue: { flexShrink: 1, ...typography.bodyStrong, lineHeight: 20 },
  legValueEmpty: { color: colors.textMuted, fontWeight: '400' },
  legDivider: { height: 1, backgroundColor: colors.borderSubtle, marginVertical: spacing.sm },

  swapBtn: {
    width: touchTarget, height: touchTarget, borderRadius: radii.pill,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  swapBtnOff: { opacity: 0.35 },
  swapBtnPressed: { borderColor: colors.primary },
});
