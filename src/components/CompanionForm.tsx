import { useState } from 'react';
import {
  Alert, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView,
  StyleSheet, Text, View,
} from 'react-native';

import { PrimaryButton } from './PrimaryButton';
import { TextField } from './TextField';
import { colors, elevation, radii, spacing, touchTarget, typography } from '../theme/tokens';
import { normalizePhone } from '../utils/phone';

/**
 * Everyone who rides under this booking/rental. The booker is always
 * passenger #1 (their name already lives on the parent row); each
 * companion is captured here and written to `passenger_details` after
 * the parent row is created (booking_id for rides, boat_rental_id for
 * charters — migration 026). Every field is required — this block IS
 * the passenger manifest (address added in migration 028).
 */
export interface Companion {
  firstName: string;
  lastName: string;
  age: number;
  sex: string;
  contact: string;
  address: string;
}

interface Props {
  companions: Companion[];
  onChange: (next: Companion[]) => void;
  /** Total seats including the booker — the add button locks at the cap. */
  maxCount: number;
  bookerName: string;
  /** Caption under the booker's row. */
  bookerMeta?: string;
  /** Caption under the card, e.g. the seat-limit wording. */
  hint?: string;
}

/** Names on a manifest: letters (any accent), spaces, hyphen, apostrophe. No digits/emoji/symbols. */
const NAME_RE = /^[A-Za-zÀ-ÖØ-öø-ÿÑñ' -]+$/;

type FieldErrors = Partial<Record<'first' | 'last' | 'age' | 'contact', string>>;

const initialsOf = (name: string) => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'Y';
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return `${parts[0].charAt(0)}${parts[parts.length - 1].charAt(0)}`.toUpperCase();
};

export function CompanionForm({
  companions,
  onChange,
  maxCount,
  bookerName,
  bookerMeta = 'You — this booking is under your name',
  hint,
}: Props) {
  const [modalOpen, setModalOpen] = useState(false);
  const [draftFirst, setDraftFirst] = useState('');
  const [draftLast, setDraftLast] = useState('');
  const [draftAge, setDraftAge] = useState('');
  const [draftSex, setDraftSex] = useState('');
  const [draftContact, setDraftContact] = useState('');
  const [draftAddress, setDraftAddress] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});

  const atCap = 1 + companions.length >= maxCount;

  // Presence gates the Add button; format errors surface on press.
  const allPresent = !!(
    draftFirst.trim() && draftLast.trim() && draftAge.trim() &&
    draftSex && draftContact.trim() && draftAddress.trim()
  );

  const edit =
    (set: (v: string) => void) =>
    (v: string) => {
      set(v);
      setErrors({});
    };

  function resetDrafts() {
    setDraftFirst('');
    setDraftLast('');
    setDraftAge('');
    setDraftSex('');
    setDraftContact('');
    setDraftAddress('');
    setErrors({});
  }

  function removeCompanion(index: number) {
    const c = companions[index];
    Alert.alert(
      'Remove this passenger?',
      `${c.firstName} ${c.lastName} will be removed from this trip.`,
      [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => onChange(companions.filter((_, i) => i !== index)),
        },
      ]
    );
  }

  function validate(): boolean {
    const next: FieldErrors = {};
    const first = draftFirst.trim();
    const last = draftLast.trim();
    if (!NAME_RE.test(first)) next.first = 'Letters, spaces, hyphens only';
    if (!NAME_RE.test(last)) next.last = 'Letters, spaces, hyphens only';
    const age = parseInt(draftAge.trim(), 10);
    if (!Number.isInteger(age) || age < 1 || age > 120) next.age = 'Age 1–120 only';
    if (!normalizePhone(draftContact.trim())) next.contact = 'Enter a valid mobile number';
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function addCompanion() {
    if (atCap || !allPresent || !validate()) return;
    onChange([
      ...companions,
      {
        firstName: draftFirst.trim(),
        lastName: draftLast.trim(),
        age: parseInt(draftAge.trim(), 10),
        sex: draftSex,
        contact: draftContact.trim(),
        address: draftAddress.trim(),
      },
    ]);
    resetDrafts();
    setModalOpen(false);
  }

  function backdropPress() {
    // First tap outside slides the keyboard down; the second closes the modal.
    if (Keyboard.isVisible()) {
      Keyboard.dismiss();
      return;
    }
    setModalOpen(false);
  }

  return (
    <View>
      <View style={styles.paxCard}>
        <View style={styles.paxRow}>
          <View style={styles.paxAvatar}>
            <Text style={styles.paxAvatarText}>{initialsOf(bookerName)}</Text>
          </View>
          <View style={styles.paxInfo}>
            <Text style={styles.paxName} numberOfLines={1}>{bookerName}</Text>
            <Text style={styles.paxMeta} numberOfLines={1}>{bookerMeta}</Text>
          </View>
        </View>

        {companions.map((c, i) => (
          <View key={`${c.lastName}-${c.firstName}-${i}`} style={[styles.paxRow, styles.paxRowDivided]}>
            <View style={[styles.paxAvatar, styles.paxAvatarAlt]}>
              <Text style={[styles.paxAvatarText, styles.paxAvatarTextAlt]}>
                {initialsOf(`${c.firstName} ${c.lastName}`)}
              </Text>
            </View>
            <View style={styles.paxInfo}>
              <Text style={styles.paxName} numberOfLines={1}>{c.firstName} {c.lastName}</Text>
              <Text style={styles.paxMeta} numberOfLines={1}>
                {`${c.age} yrs old · ${c.sex.charAt(0).toUpperCase() + c.sex.slice(1)}`}
              </Text>
            </View>
            <Pressable
              onPress={() => removeCompanion(i)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${c.firstName}`}
            >
              <Text style={styles.paxRemove}>✕</Text>
            </Pressable>
          </View>
        ))}

        <Pressable
          onPress={() => setModalOpen(true)}
          disabled={atCap}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.paxAdd,
            atCap && styles.paxAddOff,
            pressed && !atCap && styles.pressed,
          ]}
        >
          <Text style={[styles.paxAddText, atCap && styles.paxAddTextOff]}>+ Add passenger</Text>
        </Pressable>
      </View>
      {!!hint && <Text style={styles.paxHint}>{hint}</Text>}

      <Modal
        visible={modalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setModalOpen(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalBackdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={backdropPress}
            accessibilityLabel="Close"
          />
          <ScrollView
            contentContainerStyle={styles.modalScroll}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.modalCard}>
              <Pressable onPress={Keyboard.dismiss}>
                <Text style={styles.modalTitle}>Passenger information</Text>
                <Text style={styles.modalHint}>
                  They ride under your name — the bangkero checks IDs for discounts on board.
                </Text>
              </Pressable>

              <TextField
                label="First name"
                value={draftFirst}
                onChangeText={edit(setDraftFirst)}
                placeholder="Juan"
                autoCapitalize="words"
                error={errors.first ?? null}
              />
              <TextField
                label="Last name"
                value={draftLast}
                onChangeText={edit(setDraftLast)}
                placeholder="Dela Cruz"
                autoCapitalize="words"
                error={errors.last ?? null}
              />
              <View style={styles.modalRow}>
                <View style={styles.modalHalf}>
                  <TextField
                    label="Age"
                    value={draftAge}
                    onChangeText={edit(setDraftAge)}
                    placeholder="e.g. 27"
                    keyboardType="number-pad"
                    maxLength={3}
                    error={errors.age ?? null}
                  />
                </View>
                <View style={styles.modalHalf}>
                  <TextField
                    label="Contact"
                    value={draftContact}
                    onChangeText={edit(setDraftContact)}
                    placeholder="09XX XXX XXXX"
                    keyboardType="phone-pad"
                    error={errors.contact ?? null}
                  />
                </View>
              </View>

              <TextField
                label="Address"
                value={draftAddress}
                onChangeText={edit(setDraftAddress)}
                placeholder="House no., barangay, city"
                autoCapitalize="words"
                maxLength={120}
              />

              <Text style={styles.modalFieldLabel}>SEX</Text>
              <View style={styles.sexRow}>
                {(['female', 'male'] as const).map((s) => {
                  const active = draftSex === s;
                  return (
                    <Pressable
                      key={s}
                      onPress={() => {
                        // Picking a chip means the typing is done — drop the keyboard.
                        Keyboard.dismiss();
                        setDraftSex(s);
                        setErrors({});
                      }}
                      style={({ pressed }) => [styles.sexChip, active && styles.sexChipActive, pressed && !active && styles.pressed]}
                    >
                      <Text style={[styles.sexChipText, active && styles.sexChipTextActive]}>
                        {s === 'female' ? 'Female' : 'Male'}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Pressable onPress={resetDrafts} hitSlop={8} style={styles.resetBtn} accessibilityRole="button">
                <Text style={styles.resetText}>Reset</Text>
              </Pressable>

              <View style={styles.modalActions}>
                <View style={styles.modalActionBtn}>
                  <PrimaryButton
                    label="Cancel"
                    variant="secondary"
                    onPress={() => setModalOpen(false)}
                  />
                </View>
                <View style={styles.modalActionBtn}>
                  <PrimaryButton
                    label="Add passenger"
                    onPress={addCompanion}
                    disabled={!allPresent}
                  />
                </View>
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  paxCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1, borderColor: colors.borderSubtle,
    paddingHorizontal: spacing.lg,
  },
  paxRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingVertical: spacing.md,
  },
  paxRowDivided: { borderTopWidth: 1, borderTopColor: colors.borderSubtle },
  paxAvatar: {
    width: 36, height: 36, borderRadius: radii.pill,
    backgroundColor: colors.primaryTint,
    alignItems: 'center', justifyContent: 'center',
  },
  paxAvatarAlt: { backgroundColor: colors.surfaceAlt },
  paxAvatarText: { ...typography.caption, color: colors.primary, fontWeight: '700', fontSize: 12 },
  paxAvatarTextAlt: { color: colors.textSecondary },
  paxInfo: { flex: 1, minWidth: 0 },
  paxName: { flexShrink: 1, ...typography.bodyStrong },
  paxMeta: { flexShrink: 1, ...typography.caption, color: colors.textMuted, fontSize: 11, marginTop: 2 },
  paxRemove: { flexShrink: 1, color: colors.danger, fontSize: 15, fontWeight: '700', paddingHorizontal: spacing.xs },
  paxAdd: {
    minHeight: touchTarget, alignItems: 'center', justifyContent: 'center',
    borderTopWidth: 1, borderTopColor: colors.borderSubtle,
    borderStyle: 'dashed',
  },
  paxAddOff: { opacity: 0.4 },
  paxAddText: { color: colors.primary, fontSize: 14, fontWeight: '600' },
  paxAddTextOff: { color: colors.textMuted },
  paxHint: { ...typography.caption, color: colors.textMuted, fontSize: 11, marginTop: spacing.sm },
  pressed: { opacity: 0.75 },

  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  modalScroll: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xl,
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1, borderColor: colors.borderSubtle,
    padding: spacing.xl,
    ...elevation.e3,
  },
  modalTitle: { ...typography.title, marginBottom: spacing.xs },
  modalHint: { ...typography.caption, color: colors.textMuted, marginBottom: spacing.lg },
  modalRow: { flexDirection: 'row', gap: spacing.md },
  modalHalf: { flex: 1 },
  modalFieldLabel: { ...typography.label, marginBottom: spacing.sm },
  sexRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
  sexChip: {
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.borderSubtle,
    minHeight: 36, justifyContent: 'center',
  },
  sexChipActive: { backgroundColor: colors.primaryTint, borderColor: colors.primary },
  sexChipText: { ...typography.caption, color: colors.textSecondary, fontWeight: '600' },
  sexChipTextActive: { color: colors.primary },
  resetBtn: { alignSelf: 'flex-start', marginBottom: spacing.md },
  resetText: { color: colors.primary, fontSize: 13, fontWeight: '600' },
  modalActions: { flexDirection: 'row', gap: spacing.md },
  modalActionBtn: { flex: 1 },
});
