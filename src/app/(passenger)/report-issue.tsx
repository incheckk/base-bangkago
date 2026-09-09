import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/PrimaryButton';
import { ScreenContainer } from '@/components/ScreenContainer';
import { TextField } from '@/components/TextField';
import { colors, radii, spacing, typography } from '@/theme/tokens';

type IssueType = 'trip' | 'payment' | 'safety' | 'other';

const ISSUE_TYPES: { key: IssueType; label: string; icon: string }[] = [
  { key: 'trip', label: 'Trip Issue', icon: '🚢' },
  { key: 'payment', label: 'Payment', icon: '💳' },
  { key: 'safety', label: 'Safety Concern', icon: '⚠️' },
  { key: 'other', label: 'Other', icon: '📝' },
];

export default function ReportIssue() {
  const [issueType, setIssueType] = useState<IssueType | null>(null);
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [contactEmail, setContactEmail] = useState('');

  const ready = !!issueType && subject.trim() && description.trim();

  function submit() {
    Alert.alert('Report Submitted', 'Thank you for your report. Our team will review it within 24 hours.', [
      { text: 'OK', onPress: () => router.back() },
    ]);
  }

  return (
    <ScreenContainer padded={false}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.back} onPress={() => router.back()}>← Back</Text>
        <Text style={styles.title}>Report an Issue</Text>
        <Text style={styles.subtitle}>Let us know what went wrong</Text>

        <Text style={styles.sectionLabel}>ISSUE TYPE</Text>
        <View style={styles.typeGrid}>
          {ISSUE_TYPES.map((t) => (
            <Pressable
              key={t.key}
              onPress={() => setIssueType(t.key)}
              style={[styles.typeCard, issueType === t.key && styles.typeCardActive]}
            >
              <Text style={styles.typeIcon}>{t.icon}</Text>
              <Text style={[styles.typeLabel, issueType === t.key && styles.typeLabelActive]}>{t.label}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={[styles.sectionLabel, styles.mt]}>SUBJECT</Text>
        <TextField label="Subject" value={subject} onChangeText={setSubject} placeholder="Brief description of the issue" />

        <Text style={[styles.sectionLabel, styles.mt]}>DESCRIPTION</Text>
        <View style={styles.textareaWrap}>
          <TextField label="Details" value={description} onChangeText={setDescription} placeholder="What happened? When? Any booking reference?" />
        </View>

        <Text style={[styles.sectionLabel, styles.mt]}>CONTACT EMAIL (optional)</Text>
        <TextField label="Email" value={contactEmail} onChangeText={setContactEmail} placeholder="you@email.com" />

        <PrimaryButton label="Submit Report" onPress={submit} disabled={!ready} />
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl },
  back: { color: colors.primary, fontSize: 14, fontWeight: '600', marginBottom: spacing.lg },
  title: { ...typography.h1, marginBottom: spacing.xs },
  subtitle: { ...typography.caption, marginBottom: spacing.xl },

  sectionLabel: { ...typography.label, marginBottom: spacing.md },
  mt: { marginTop: spacing.xl },

  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  typeCard: {
    width: '47%',
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
    alignItems: 'center',
    gap: spacing.sm,
  },
  typeCardActive: { backgroundColor: colors.surfaceAlt, borderColor: colors.primary },
  typeIcon: { fontSize: 24 },
  typeLabel: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  typeLabelActive: { color: colors.primary },

  textareaWrap: { minHeight: 100 },
});
