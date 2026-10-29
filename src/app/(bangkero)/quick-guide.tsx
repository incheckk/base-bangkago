import { router } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { BangkeroScreenHeader } from '@/components/BangkeroScreenHeader';
import { PrimaryButton } from '@/components/PrimaryButton';
import { ScreenContainer } from '@/components/ScreenContainer';
import { useAuth } from '@/hooks/useAuth';
import { requestReplay } from '@/hooks/useOnboarding';
import { colors, radii, spacing, typography } from '@/theme/tokens';

/**
 * Guide + tutorial in one screen (they were two menu rows saying the same
 * thing). The steps describe the real flow, and the replay button is the
 * same first-run walkthrough the home screen shows — no second tutorial.
 */
const STEPS = [
  {
    num: '1',
    title: 'Get verified',
    desc: 'Upload your ID, boat registration and permits. The admin reviews them, then your boat can go online.',
  },
  {
    num: '2',
    title: 'Go online at a port',
    desc: 'Switch availability on while you are at the port. You join that port\'s queue, and ready boats are offered requests first.',
  },
  {
    num: '3',
    title: 'Accept requests',
    desc: 'Solo, group and padala requests arrive on Home. Everything you accept for the same day and route becomes one trip, with one manifest.',
  },
  {
    num: '4',
    title: 'Prepare departure',
    desc: 'Open the manifest, scan each boarding QR, mark no-shows, then start the trip. The manifest lists every passenger and parcel aboard.',
  },
  {
    num: '5',
    title: 'Sail, arrive and complete',
    desc: 'En Route tracks your boat and warns the coast guard if you stop moving. Complete Trip closes the manifest and adds the fares to Earnings.',
  },
];

export default function QuickGuide() {
  const { user } = useAuth();

  return (
    <ScreenContainer padded={false}>
      <BangkeroScreenHeader eyebrow="BANGKERO" title="Guide & Tutorial" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.subtitle}>
          How a day on BangkaGo works, from documents to completed trips.
        </Text>

        <View style={styles.steps}>
          {STEPS.map((s) => (
            <View key={s.num} style={styles.step}>
              <View style={styles.stepNum}>
                <Text style={styles.stepNumText}>{s.num}</Text>
              </View>
              <View style={styles.stepContent}>
                <Text style={styles.stepTitle}>{s.title}</Text>
                <Text style={styles.stepDesc}>{s.desc}</Text>
              </View>
            </View>
          ))}
        </View>

        <View style={styles.tutorialCard}>
          <Text style={styles.tutorialTitle}>Walkthrough</Text>
          <Text style={styles.tutorialText}>
            The first time you sign in, BangkaGo points out the important parts of Home.
            Replay it any time — it takes under a minute.
          </Text>
          <PrimaryButton
            label="Replay tutorial"
            onPress={() => {
              void requestReplay(user?.id ?? null);
              router.replace('/(bangkero)/home');
            }}
            style={{ marginTop: spacing.md }}
          />
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  subtitle: { ...typography.body, color: colors.textSecondary, lineHeight: 21 },

  steps: { marginTop: spacing.xl, gap: spacing.lg },
  step: { flexDirection: 'row', gap: spacing.md },
  stepNum: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: colors.primaryTint,
    alignItems: 'center', justifyContent: 'center',
    marginTop: 1,
  },
  stepNumText: { color: colors.primary, fontSize: 13, fontWeight: '800' },
  stepContent: { flex: 1 },
  stepTitle: { ...typography.bodyStrong, marginBottom: 2 },
  stepDesc: { ...typography.caption, color: colors.textSecondary, lineHeight: 18 },

  tutorialCard: {
    marginTop: spacing.xxl,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
  },
  tutorialTitle: { ...typography.title, fontSize: 16 },
  tutorialText: { ...typography.caption, color: colors.textSecondary, lineHeight: 18, marginTop: spacing.xs },
});
