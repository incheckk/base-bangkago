import React, { useState } from 'react';
import {
  Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';

import { FilterChips } from './FilterChips';
import { PrimaryButton } from './PrimaryButton';
import { ScreenContainer } from './ScreenContainer';
import { TextField } from './TextField';
import { useAuth } from '@/hooks/useAuth';
import { createAlert } from '@/services/safety-alert.service';
import { friendlyError } from '@/services/booking.service';
import type { AlertSeverity } from '@/types/models';
import { colors, radii, spacing, typography } from '@/theme/tokens';

const CATEGORIES: {
  key: string;
  label: string;
  severity: AlertSeverity;
}[] = [
  { key: 'safety', label: 'Safety hazard', severity: 'high' },
  { key: 'overcharge', label: 'Overcharging', severity: 'medium' },
  { key: 'behavior', label: 'Behavior', severity: 'medium' },
  { key: 'vessel', label: 'Vessel condition', severity: 'medium' },
  { key: 'other', label: 'Other', severity: 'low' },
];

interface Props {
  header: React.ReactNode;
}

/**
 * Non-emergency compliance report shared by passenger and bangkero.
 *
 * The row is a safety_alert in the same `[Compliance Report]` shape the
 * Admin Compliance & Feedback page parses, so Filed By, Category, Subject,
 * and Zone render in the existing table without another table or policy.
 */
export function ReportIssueForm({ header }: Props) {
  const { profile } = useAuth();
  const [category, setCategory] = useState(CATEGORIES[0].key);
  const [subject, setSubject] = useState('');
  const [zone, setZone] = useState('');
  const [details, setDetails] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const selected = CATEGORIES.find((c) => c.key === category) ?? CATEGORIES[0];

  async function submit() {
    setError(null);
    if (subject.trim().length < 3) {
      setError('Enter a short subject for the report.');
      return;
    }
    if (details.trim().length < 10) {
      setError('Describe what happened in at least 10 characters.');
      return;
    }

    setSending(true);
    try {
      const who = profile
        ? `${profile.firstName} ${profile.lastName}`.trim()
        : 'A signed-in user';
      const message = [
        '[Compliance Report]',
        `Filed By: ${who} (${profile?.role ?? 'user'})`,
        `Category: ${selected.label}`,
        `Subject: ${subject.trim()}`,
        `Zone: ${zone.trim() || 'Not specified'}`,
        '',
        details.trim(),
      ].join('\n');

      await createAlert({ message, severity: selected.severity });
      setSubject('');
      setZone('');
      setDetails('');
      setSent(true);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setSending(false);
    }
  }

  return (
    <ScreenContainer padded={false}>
      {header}
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.intro}>
          <Text style={styles.introTitle}>Report a non-emergency issue</Text>
          <Text style={styles.introBody}>
            Compliance reports go to Admin and the Coast Guard. For an emergency,
            use SOS instead so responders see it immediately.
          </Text>
        </View>

        {sent && (
          <View style={styles.successBox} accessibilityRole="alert">
            <Text style={styles.successTitle}>Report submitted</Text>
            <Text style={styles.successBody}>
              Admin and the Coast Guard can now review it in the compliance queue.
            </Text>
            <Pressable onPress={() => setSent(false)} hitSlop={8}>
              <Text style={styles.successLink}>File another report</Text>
            </Pressable>
          </View>
        )}

        <Text style={styles.label}>CATEGORY</Text>
        <FilterChips
          filters={CATEGORIES.map((c) => ({ key: c.key, label: c.label }))}
          active={category}
          onChange={(key) => { setCategory(key); setSent(false); }}
        />

        <TextField
          label="Subject"
          value={subject}
          onChangeText={(value) => { setSubject(value); setSent(false); }}
          placeholder="e.g. Shortchanged on the fare"
          autoCapitalize="sentences"
          maxLength={160}
        />

        <TextField
          label="Location / Zone"
          value={zone}
          onChangeText={(value) => { setZone(value); setSent(false); }}
          placeholder="e.g. Mactan Wharf, East Marker 4"
          autoCapitalize="sentences"
          maxLength={160}
        />

        <Text style={styles.label}>DETAILS</Text>
        <View style={styles.detailsField}>
          <TextInput
            style={styles.detailsInput}
            value={details}
            onChangeText={(value) => { setDetails(value); setSent(false); }}
            placeholder="Describe what happened, who was involved, and when."
            placeholderTextColor={colors.textMuted}
            multiline
            textAlignVertical="top"
            maxLength={2000}
          />
        </View>
        <Text style={styles.counter}>{details.length}/2000</Text>

        {!!error && <Text style={styles.error}>{error}</Text>}

        <PrimaryButton
          label="Submit report"
          onPress={() => void submit()}
          loading={sending}
          disabled={sending}
          style={styles.submit}
        />
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.huge },
  intro: { marginBottom: spacing.lg },
  introTitle: { ...typography.h2, marginBottom: spacing.xs },
  introBody: { ...typography.body, color: colors.textSecondary, lineHeight: 20 },
  successBox: {
    backgroundColor: colors.primaryTint,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radii.md,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  successTitle: { ...typography.bodyStrong, color: colors.text, marginBottom: spacing.xxs },
  successBody: { ...typography.caption, color: colors.textSecondary, lineHeight: 18 },
  successLink: {
    color: colors.primary,
    fontWeight: '700',
    fontSize: 13,
    marginTop: spacing.sm,
  },
  label: { ...typography.label, marginBottom: spacing.sm },
  detailsField: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    minHeight: 140,
  },
  detailsInput: {
    flex: 1,
    minHeight: 120,
    color: colors.text,
    fontSize: 15,
    lineHeight: 21,
  },
  counter: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'right',
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
  },
  error: {
    color: colors.danger,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: spacing.md,
  },
  submit: { marginTop: spacing.sm },
});
