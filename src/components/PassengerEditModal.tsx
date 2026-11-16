import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';

import { FilterChips } from './FilterChips';
import { PrimaryButton } from './PrimaryButton';
import { TextField } from './TextField';
import { Icon } from './Icon';
import { deletePassengerDetail, updatePassengerDetail } from '@/services/passenger-detail.service';
import { friendlyError } from '@/services/booking.service';
import type { PassengerDetailDoc, PassengerType } from '@/types/models';
import { colors, radii, spacing, typography } from '@/theme/tokens';

const PASSENGER_TYPES: { key: PassengerType; label: string }[] = [
  { key: 'regular', label: 'Regular' },
  { key: 'student', label: 'Student' },
  { key: 'senior', label: 'Senior' },
  { key: 'child', label: 'Child' },
];

interface Props {
  visible: boolean;
  passenger: PassengerDetailDoc | null;
  onClose: () => void;
  /** Called after a successful save or delete so the parent can reload. */
  onChanged: () => void;
}

/**
 * One edit sheet for every passenger-list surface (admin, bangkero, passenger).
 * The database still owns the rules: the guard trigger refuses ownership/QR
 * changes and edits after departure, and the delete RPC moves pax count and
 * fare together.
 */
export function PassengerEditModal({ visible, passenger, onClose, onChanged }: Props) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [age, setAge] = useState('');
  const [sex, setSex] = useState('');
  const [contact, setContact] = useState('');
  const [address, setAddress] = useState('');
  const [weight, setWeight] = useState('');
  const [passengerType, setPassengerType] = useState<PassengerType>('regular');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!passenger) return;
    setFirstName(passenger.firstName);
    setLastName(passenger.lastName);
    setAge(passenger.age != null ? String(passenger.age) : '');
    setSex(passenger.sex ?? '');
    setContact(passenger.contactNumber ?? '');
    setAddress(passenger.address ?? '');
    setWeight(passenger.declaredWeightKg != null ? String(passenger.declaredWeightKg) : '');
    setPassengerType(passenger.passengerType);
    setError(null);
  }, [passenger]);

  const busy = saving || deleting;

  async function save() {
    if (!passenger || busy) return;
    setError(null);
    if (!firstName.trim() || !lastName.trim()) {
      setError('Enter the passenger’s first and last name.');
      return;
    }
    const ageValue = age.trim() ? Number(age.trim()) : null;
    if (ageValue != null && (!Number.isFinite(ageValue) || ageValue < 0 || ageValue > 120)) {
      setError('Age must be a number between 0 and 120.');
      return;
    }
    const weightValue = weight.trim() ? Number(weight.trim()) : null;
    if (weightValue != null && (!Number.isFinite(weightValue) || weightValue <= 0 || weightValue > 500)) {
      setError('Weight must be a number between 1 and 500 kg.');
      return;
    }

    setSaving(true);
    try {
      await updatePassengerDetail(passenger.passengerId, {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        age: ageValue,
        sex: sex.trim() || null,
        contactNumber: contact.trim() || null,
        address: address.trim() || null,
        passengerType,
        declaredWeightKg: weightValue,
      });
      onChanged();
      onClose();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setSaving(false);
    }
  }

  function confirmDelete() {
    if (!passenger || busy) return;
    Alert.alert(
      'Remove this passenger?',
      `${passenger.firstName} ${passenger.lastName} will be removed from the list. The booking’s pax count and fare are recalculated.`,
      [
        { text: 'Keep passenger', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => void remove() },
      ]
    );
  }

  async function remove() {
    if (!passenger || busy) return;
    setError(null);
    setDeleting(true);
    try {
      await deletePassengerDetail(passenger.passengerId);
      onChanged();
      onClose();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        <View style={styles.sheet}>
          <View style={styles.head}>
            <View style={styles.headText}>
              <Text style={styles.title}>Edit passenger</Text>
              <Text style={styles.subtitle} numberOfLines={1}>
                Ownership and boarding status are protected.
              </Text>
            </View>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close"
              style={({ pressed }) => [styles.closeBtn, pressed && styles.pressed]}
            >
              <Icon name="close" size={20} color={colors.textSecondary} />
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={styles.body}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <TextField
              label="First name"
              value={firstName}
              onChangeText={setFirstName}
              placeholder="First name"
              autoCapitalize="words"
              maxLength={80}
            />
            <TextField
              label="Last name"
              value={lastName}
              onChangeText={setLastName}
              placeholder="Last name"
              autoCapitalize="words"
              maxLength={80}
            />
            <View style={styles.duo}>
              <View style={styles.duoItem}>
                <TextField
                  label="Age"
                  value={age}
                  onChangeText={setAge}
                  placeholder="0"
                  keyboardType="number-pad"
                  maxLength={3}
                />
              </View>
              <View style={styles.duoItem}>
                <TextField
                  label="Weight (kg)"
                  value={weight}
                  onChangeText={setWeight}
                  placeholder="Optional"
                  keyboardType="decimal-pad"
                  maxLength={6}
                />
              </View>
            </View>
            <TextField
              label="Sex"
              value={sex}
              onChangeText={setSex}
              placeholder="e.g. Female"
              autoCapitalize="words"
              maxLength={20}
            />
            <TextField
              label="Contact number"
              value={contact}
              onChangeText={setContact}
              placeholder="+63 9XX XXX XXXX"
              keyboardType="phone-pad"
              maxLength={20}
            />
            <TextField
              label="Address"
              value={address}
              onChangeText={setAddress}
              placeholder="Home address"
              autoCapitalize="sentences"
              maxLength={200}
            />

            <Text style={styles.label}>PASSENGER TYPE</Text>
            <FilterChips
              filters={PASSENGER_TYPES}
              active={passengerType}
              onChange={(key) => setPassengerType(key as PassengerType)}
            />

            {!!error && <Text style={styles.error}>{error}</Text>}

            <PrimaryButton
              label="Save changes"
              onPress={() => void save()}
              loading={saving}
              disabled={busy}
              style={styles.saveBtn}
            />

            <Pressable
              onPress={confirmDelete}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Remove passenger"
              style={({ pressed }) => [styles.deleteBtn, pressed && !busy && styles.pressed]}
            >
              {deleting ? (
                <ActivityIndicator color={colors.danger} />
              ) : (
                <Text style={styles.deleteText}>Remove passenger</Text>
              )}
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(8, 20, 30, 0.48)', justifyContent: 'flex-end' },
  sheet: {
    maxHeight: '90%',
    backgroundColor: colors.bg,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    overflow: 'hidden',
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  headText: { flex: 1, minWidth: 0 },
  title: { ...typography.h2 },
  subtitle: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceAlt,
  },
  body: { paddingHorizontal: spacing.xl, paddingTop: spacing.lg, paddingBottom: spacing.huge },
  duo: { flexDirection: 'row', gap: spacing.md },
  duoItem: { flex: 1 },
  label: { ...typography.label, marginBottom: spacing.sm },
  error: { color: colors.danger, fontSize: 13, lineHeight: 18, marginBottom: spacing.md },
  saveBtn: { marginTop: spacing.sm },
  deleteBtn: {
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  deleteText: { color: colors.danger, fontSize: 14, fontWeight: '700' },
  pressed: { opacity: 0.7 },
});
