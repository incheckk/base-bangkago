import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from './Icon';
import { colors, elevation, radii, spacing, touchTarget, typography } from '../theme/tokens';

/**
 * Structural, not `PortDoc` — admin screens hold trimmed port rows and should
 * be able to use the same picker without widening their own types.
 */
export interface PickablePort {
  portId: string;
  portName: string;
  location?: string | null;
}

/**
 * Why a sheet and not a chip grid.
 *
 * Nine ports × two legs meant eighteen pill buttons on the booking form, which
 * is a wall of near-identical targets that grows every time the LGU adds a
 * port. A field that states the current choice and opens a list on demand costs
 * one row of height regardless of how many ports exist, and it reads as a
 * single decision rather than a puzzle.
 *
 * `Modal` is deliberate: it renders at the root of the app, so it cannot
 * inherit a scroll container's coordinate space the way an absolutely
 * positioned overlay can.
 */
export function PortPickerSheet({
  visible, onClose, title, ports, selected, isDisabled, onSelect,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  ports: PickablePort[];
  selected: string | null;
  /** Return a short reason to block a port, or null to allow it. */
  isDisabled?: (portId: string) => string | null;
  onSelect: (portId: string) => void;
}) {
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />

        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]}>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>{title}</Text>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close"
              style={({ pressed }) => [styles.closeBtn, pressed && styles.rowPressed]}
            >
              <Icon name="close" size={20} color={colors.textSecondary} />
            </Pressable>
          </View>

          {ports.length === 0 ? (
            <Text style={styles.emptyNote}>No ports available right now.</Text>
          ) : (
            <ScrollView
              style={styles.list}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.listInner}
            >
              {ports.map((p) => {
                const reason = isDisabled?.(p.portId) ?? null;
                const active = p.portId === selected;
                return (
                  <Pressable
                    key={p.portId}
                    disabled={!!reason}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active, disabled: !!reason }}
                    accessibilityLabel={reason ? `${p.portName}, unavailable: ${reason}` : p.portName}
                    onPress={() => {
                      onSelect(p.portId);
                      onClose();
                    }}
                    style={({ pressed }) => [
                      styles.row,
                      active && styles.rowActive,
                      pressed && !reason && styles.rowPressed,
                    ]}
                  >
                    <Icon
                      name="port"
                      size={18}
                      color={reason ? colors.textOnDisabled : active ? colors.primary : colors.textMuted}
                    />
                    <View style={styles.rowBody}>
                      <Text
                        style={[
                          styles.rowName,
                          active && styles.rowNameActive,
                          !!reason && styles.rowTextOff,
                        ]}
                        numberOfLines={1}
                      >
                        {p.portName}
                      </Text>
                      {/* The blocking reason replaces the location: when a port
                          can't be picked, why matters more than where it is. */}
                      {(reason || p.location) && (
                        <Text
                          style={[styles.rowMeta, !!reason && styles.rowTextOff]}
                          numberOfLines={1}
                        >
                          {reason ?? p.location}
                        </Text>
                      )}
                    </View>
                    {active && <Icon name="check" size={20} color={colors.primary} />}
                  </Pressable>
                );
              })}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

/**
 * A labelled dropdown field. Opens `PortPickerSheet` and shows the current
 * choice, or the placeholder when nothing is picked yet.
 */
export function PortSelect({
  label, sheetTitle, ports, value, onChange, isDisabled, placeholder = 'Select a port',
  disabledHint, locked = false,
}: {
  label: string;
  /** Heading on the sheet. Defaults to `label`, which is wrong when the
   *  field label is an all-caps section header. */
  sheetTitle?: string;
  ports: PickablePort[];
  value: string | null;
  onChange: (portId: string) => void;
  isDisabled?: (portId: string) => string | null;
  placeholder?: string;
  /** Shown instead of the placeholder when the field itself can't be opened. */
  disabledHint?: string;
  locked?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const picked = ports.find((p) => p.portId === value) ?? null;

  return (
    <View>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Pressable
        onPress={() => setOpen(true)}
        disabled={locked}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${picked?.portName ?? placeholder}`}
        style={({ pressed }) => [
          styles.field,
          locked && styles.fieldLocked,
          pressed && !locked && styles.fieldPressed,
        ]}
      >
        <Icon name="port" size={18} color={picked ? colors.primary : colors.textMuted} />
        <Text
          style={[styles.fieldValue, !picked && styles.fieldPlaceholder]}
          numberOfLines={1}
        >
          {picked?.portName ?? (disabledHint && locked ? disabledHint : placeholder)}
        </Text>
        {!locked && <Icon name="expand" size={18} color={colors.textMuted} />}
      </Pressable>

      <PortPickerSheet
        visible={open}
        onClose={() => setOpen(false)}
        title={sheetTitle ?? label}
        ports={ports}
        selected={value}
        isDisabled={isDisabled}
        onSelect={onChange}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // ---------- field ----------
  fieldLabel: { ...typography.label, marginBottom: spacing.sm },
  field: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    minHeight: 52,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1, borderColor: colors.borderSubtle,
    paddingHorizontal: spacing.lg,
  },
  fieldPressed: { borderColor: colors.primary, backgroundColor: colors.surfaceAlt },
  fieldLocked: { opacity: 0.6 },
  fieldValue: { flex: 1, minWidth: 0, ...typography.bodyStrong },
  fieldPlaceholder: { color: colors.textMuted, fontWeight: '400' },

  // ---------- sheet ----------
  backdrop: { flex: 1, backgroundColor: colors.backdrop, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.bgElevated,
    borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl,
    borderTopWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.lg, paddingTop: spacing.lg,
    // Capped so the map and the rest of the form stay visible behind it —
    // the picker is a detour, not a new screen.
    maxHeight: '72%',
    ...elevation.e3,
  },
  sheetHead: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    gap: spacing.md, marginBottom: spacing.md,
  },
  sheetTitle: { flexShrink: 1, ...typography.title },
  closeBtn: {
    width: touchTarget, height: touchTarget, borderRadius: radii.pill,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.borderSubtle,
  },

  list: { flexGrow: 0 },
  listInner: { paddingBottom: spacing.sm, gap: spacing.xs },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    minHeight: 56,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1, borderColor: 'transparent',
  },
  rowActive: { backgroundColor: colors.primaryTint, borderColor: colors.primary },
  rowPressed: { backgroundColor: colors.surfaceAlt },
  rowBody: { flex: 1, minWidth: 0 },
  rowName: { flexShrink: 1, ...typography.bodyStrong },
  rowNameActive: { color: colors.primary },
  rowMeta: { flexShrink: 1, ...typography.label, fontWeight: '400', letterSpacing: 0 },
  rowTextOff: { color: colors.textOnDisabled },

  emptyNote: {
    ...typography.caption, color: colors.textMuted,
    paddingVertical: spacing.xl, textAlign: 'center',
  },
});
