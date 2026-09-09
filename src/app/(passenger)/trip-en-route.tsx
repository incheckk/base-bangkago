import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, radii, spacing } from '@/theme/tokens';
import { ScreenContainer } from '@/components/ScreenContainer';
import { StatusPill } from '@/components/StatusPill';
import { StarRating } from '@/components/StarRating';

const STEPS = ['Boarded', 'En Route', 'Arriving', 'Arrived'];

export default function TripEnRoute() {
  const [currentStep, setCurrentStep] = useState(1);

  return (
    <ScreenContainer>
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Map area */}
        <View style={styles.mapArea}>
          <Text style={styles.mapPlaceholder}>Live tracking</Text>
        </View>

        <View style={styles.content}>
          {/* Status pill */}
          <View style={styles.statusRow}>
            <StatusPill status="accepted" />
            <Text style={styles.eta}>ETA: 12 min</Text>
          </View>

          {/* Bangkero info card */}
          <View style={styles.card}>
            <View style={styles.bangkeroRow}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>MC</Text>
              </View>
              <View style={styles.bangkeroInfo}>
                <Text style={styles.bangkeroName}>Mang Carlo</Text>
                <Text style={styles.boatName}>Boat: Star Ferry II</Text>
                <StarRating rating={4.8} />
              </View>
            </View>
          </View>

          {/* Trip progress */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Trip Progress</Text>
            <View style={styles.stepsContainer}>
              {STEPS.map((step, i) => (
                <View key={step} style={styles.stepItem}>
                  <View style={[styles.stepDot, i <= currentStep && styles.stepDotActive]}>
                    <Text style={[styles.stepDotText, i <= currentStep && styles.stepDotTextActive]}>
                      {i < currentStep ? '✓' : i + 1}
                    </Text>
                  </View>
                  <Text style={[styles.stepLabel, i <= currentStep && styles.stepLabelActive]}>
                    {step}
                  </Text>
                  {i < STEPS.length - 1 && (
                    <View style={[styles.stepLine, i < currentStep && styles.stepLineActive]} />
                  )}
                </View>
              ))}
            </View>
          </View>

          {/* Action buttons */}
          <View style={styles.actions}>
            <Pressable
              style={styles.sosButton}
              onPress={() => {}}
            >
              <Text style={styles.sosText}>SOS — Emergency</Text>
            </Pressable>

            <Pressable
              style={styles.contactButton}
              onPress={() => {}}
            >
              <Text style={styles.contactText}>Contact Bangkero</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: spacing.xxl },
  mapArea: {
    height: 260,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    borderBottomLeftRadius: radii.lg,
    borderBottomRightRadius: radii.lg,
  },
  mapPlaceholder: { color: colors.textMuted, fontSize: 13 },
  content: { padding: spacing.lg, gap: spacing.lg },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  eta: {
    color: colors.primary,
    fontSize: 15,
    fontWeight: '600',
  },
  card: {
    backgroundColor: colors.bgElevated,
    borderRadius: radii.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  bangkeroRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: colors.primaryText,
    fontSize: 15,
    fontWeight: '700',
  },
  bangkeroInfo: { gap: 2 },
  bangkeroName: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
  boatName: {
    color: colors.textSecondary,
    fontSize: 11,
  },
  cardTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
    marginBottom: spacing.md,
  },
  stepsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stepItem: {
    alignItems: 'center',
    flex: 1,
  },
  stepDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 2,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepDotActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  stepDotText: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
  },
  stepDotTextActive: {
    color: colors.primaryText,
  },
  stepLabel: {
    color: colors.textMuted,
    fontSize: 10,
    marginTop: spacing.xs,
  },
  stepLabelActive: {
    color: colors.primary,
  },
  stepLine: {
    position: 'absolute',
    top: 14,
    left: '60%',
    right: '-60%',
    height: 2,
    backgroundColor: colors.border,
  },
  stepLineActive: {
    backgroundColor: colors.primary,
  },
  actions: { gap: spacing.md },
  sosButton: {
    backgroundColor: colors.danger,
    borderRadius: radii.pill,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  sosText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  contactButton: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.pill,
    paddingVertical: spacing.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  contactText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
});
