import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from './Icon';
import { TextField } from './TextField';
import { REGION7_CITIES } from '../data/region7';
import { colors, elevation, radii, spacing, touchTarget, typography } from '../theme/tokens';

/**
 * Age and address fields for the two passenger-information surfaces
 * (CompanionForm and PassengerEditModal). A typing field for either was
 * error-prone: ages outside 1–120, addresses that are half a street. This
 * picks from lists instead, so every saved row is a real place.
 *
 * The address stays ONE string in `passenger_details.address` (028) — no
 * migration — composed from house/street + barangay + city + Region VII.
 */

/** "City of Lapu-Lapu" reads like a database row; people say "Lapu-Lapu City". */
export function cityLabel(name: string): string {
  return name.startsWith('City of ') ? `${name.slice(8)} City` : name;
}

export function composeAddress(street: string, barangay: string, city: string): string {
  return [street.trim(), barangay, city, 'Region VII']
    .filter(Boolean)
    .join(', ');
}

/** Pull a previously saved address back into the three picker states. */
export function parseAddress(value: string): { street: string; city: string; barangay: string } {
  const match = REGION7_CITIES.find((c) => value.includes(cityLabel(c.name)));
  if (!match) return { street: value.trim(), city: '', barangay: '' };
  const label = cityLabel(match.name);
  const barangay =
    [...match.barangays]
      .sort((a, b) => b.length - a.length)
      .find((b) => value.includes(b)) ?? '';
  let street = value;
  for (const part of [barangay, match.name, label, 'Region VII', 'Central Visayas']) {
    if (part) street = street.split(part).join(' ');
  }
  street = street
    .replace(/\s*,\s*/g, ', ')
    .replace(/^[,\s]+|[,\s]+$/g, '')
    .trim();
  return { street, city: label, barangay };
}

const AGE_OPTIONS = Array.from({ length: 120 }, (_, i) => String(i + 1));

function ChoiceSheet({
  visible, title, options, selected, onSelect, onClose,
}: {
  visible: boolean;
  title: string;
  options: string[];
  selected: string;
  onSelect: (value: string) => void;
  onClose: () => void;
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
              style={({ pressed }) => [styles.closeBtn, pressed && styles.pressed]}
            >
              <Icon name="close" size={20} color={colors.textSecondary} />
            </Pressable>
          </View>
          <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
            {options.map((option) => {
              const active = option === selected;
              return (
                <Pressable
                  key={option}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() => {
                    onSelect(option);
                    onClose();
                  }}
                  style={({ pressed }) => [
                    styles.row,
                    active && styles.rowActive,
                    pressed && styles.rowPressed,
                  ]}
                >
                  <Text
                    style={[styles.rowName, active && styles.rowNameActive]}
                    numberOfLines={2}
                  >
                    {option}
                  </Text>
                  {active && <Icon name="check" size={20} color={colors.primary} />}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function ChoiceField({
  label, value, placeholder, options, onSelect, error, title, disabled, disabledHint,
}: {
  label: string;
  value: string;
  placeholder: string;
  options: string[];
  onSelect: (value: string) => void;
  error?: string | null;
  title?: string;
  disabled?: boolean;
  disabledHint?: string;
}) {
  const [open, setOpen] = useState(false);
  const shown = value || (disabled && disabledHint ? disabledHint : placeholder);
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>{label.toUpperCase()}</Text>
      <Pressable
        onPress={() => setOpen(true)}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value || placeholder}`}
        style={({ pressed }) => [
          styles.field,
          !!error && styles.fieldError,
          disabled && styles.fieldLocked,
          pressed && !disabled && styles.fieldPressed,
        ]}
      >
        <Text style={[styles.fieldValue, !value && styles.fieldPlaceholder]} numberOfLines={1}>
          {shown}
        </Text>
        {!disabled && <Icon name="expand" size={18} color={colors.textMuted} />}
      </Pressable>
      {!!error && <Text style={styles.error}>{error}</Text>}
      <ChoiceSheet
        visible={open}
        title={title ?? label}
        options={options}
        selected={value}
        onSelect={onSelect}
        onClose={() => setOpen(false)}
      />
    </View>
  );
}

export function AgePicker({
  value, onChange, error,
}: {
  /** '' until the picker is used. */
  value: string;
  onChange: (value: string) => void;
  error?: string | null;
}) {
  return (
    <ChoiceField
      label="Age"
      title="Age"
      value={value}
      placeholder="Select age"
      options={AGE_OPTIONS}
      onSelect={onChange}
      error={error}
    />
  );
}

/**
 * Remount this with a `key` when the passenger changes — its internal
 * picks initialise from `value` once.
 */
export function AddressPicker({
  value, onChange, error,
}: {
  value: string;
  onChange: (value: string) => void;
  error?: string | null;
}) {
  // Parsed once: `value` is our own output after the first keystroke.
  const [initial] = useState(() => parseAddress(value));
  const [street, setStreet] = useState(initial.street);
  const [city, setCity] = useState(initial.city);
  const [barangay, setBarangay] = useState(initial.barangay);
  const [streetError, setStreetError] = useState<string | null>(null);

  const cityRow = REGION7_CITIES.find((c) => cityLabel(c.name) === city);
  const cityOptions = useMemo(() => REGION7_CITIES.map((c) => cityLabel(c.name)), []);

  function emit(nextStreet: string, nextBarangay: string, nextCity: string) {
    onChange(composeAddress(nextStreet, nextBarangay, nextCity));
  }

  return (
    <View>
      <TextField
        label="House no. / street"
        value={street}
        onChangeText={(text) => {
          setStreet(text);
          setStreetError(null);
          emit(text, barangay, city);
        }}
        placeholder="e.g. 12 Mabini St."
        autoCapitalize="words"
        maxLength={80}
        error={streetError}
      />
      <View style={styles.lockedRow}>
        <Text style={styles.fieldLabel}>REGION</Text>
        <View style={[styles.field, styles.fieldLocked]}>
          <Text style={styles.fieldValue} numberOfLines={1}>Region VII · Central Visayas</Text>
        </View>
      </View>
      <View style={styles.duo}>
        <View style={styles.duoItem}>
          <ChoiceField
            label="City / municipality"
            title="City or municipality"
            value={city}
            placeholder="Select city"
            options={cityOptions}
            onSelect={(next) => {
              setCity(next);
              setBarangay('');
              emit(street, '', next);
            }}
            error={error ? 'Pick a city' : null}
          />
        </View>
        <View style={styles.duoItem}>
          <ChoiceField
            label="Barangay"
            title="Barangay"
            value={barangay}
            placeholder={city ? 'Select barangay' : 'Pick a city first'}
            options={cityRow?.barangays ?? []}
            disabled={!cityRow}
            disabledHint="Pick a city first"
            onSelect={(next) => {
              setBarangay(next);
              emit(street, next, city);
            }}
            error={error ? 'Pick a barangay' : null}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fieldWrap: { marginBottom: spacing.lg },
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
  fieldError: { borderColor: colors.danger },
  fieldLocked: { opacity: 0.6 },
  fieldValue: { flex: 1, minWidth: 0, ...typography.bodyStrong },
  fieldPlaceholder: { color: colors.textMuted, fontWeight: '400' },
  error: { color: colors.danger, fontSize: 12, marginTop: spacing.xs },
  lockedRow: { marginBottom: spacing.lg },
  duo: { flexDirection: 'row', gap: spacing.md },
  duoItem: { flex: 1 },

  backdrop: { flex: 1, backgroundColor: colors.backdrop, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.bgElevated,
    borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl,
    borderTopWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.lg, paddingTop: spacing.lg,
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
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    minHeight: 52,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1, borderColor: 'transparent',
  },
  rowActive: { backgroundColor: colors.primaryTint, borderColor: colors.primary },
  rowPressed: { backgroundColor: colors.surfaceAlt },
  rowName: { flex: 1, minWidth: 0, ...typography.bodyStrong },
  rowNameActive: { color: colors.primary },
  pressed: { opacity: 0.7 },
});
