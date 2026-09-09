import { router } from 'expo-router';
import { useState } from 'react';
import {
  Alert, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';

import { PrimaryButton } from '@/components/PrimaryButton';
import { ScreenContainer } from '@/components/ScreenContainer';
import { StatusCard } from '@/components/StatusCard';
import { useAuth } from '@/hooks/useAuth';
import { useSafetyAlerts } from '@/hooks/useSafetyAlerts';
import { colors, radii, spacing, typography } from '@/theme/tokens';

export default function SosAlertScreen() {
  const { profile } = useAuth();
  const portId = profile?.uid ? 'p1' : null;
  const { data: alerts, loading } = useSafetyAlerts(portId);

  const [alertState, setAlertState] = useState<'idle' | 'sending' | 'sent'>('idle');

  function handleSos() {
    Alert.alert(
      'Emergency SOS',
      'This will send an emergency alert to the coast guard and nearby vessels. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send Alert',
          style: 'destructive',
          onPress: () => {
            setAlertState('sending');
            setTimeout(() => setAlertState('sent'), 1500);
          },
        },
      ],
    );
  }

  return (
    <ScreenContainer padded={false}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.back} onPress={() => router.back()}>← Back</Text>

        <Text style={styles.eyebrow}>EMERGENCY</Text>
        <Text style={styles.title}>Emergency SOS</Text>

        <View style={styles.sosWrap}>
          <Pressable
            onPress={handleSos}
            disabled={alertState === 'sending'}
            style={({ pressed }) => [
              styles.sosButton,
              alertState === 'sent' && styles.sosSent,
              pressed && alertState === 'idle' && styles.sosPressed,
            ]}
          >
            <Text style={styles.sosText}>{alertState === 'sent' ? '✓' : 'SOS'}</Text>
          </Pressable>
          <Text style={styles.sosLabel}>
            {alertState === 'sent'
              ? 'Alert Sent'
              : 'Tap to send emergency alert to coast guard'}
          </Text>
        </View>

        {alertState === 'sent' && (
          <View style={styles.sentBanner}>
            <Text style={styles.sentBannerText}>
              Emergency alert has been sent. Stay in position and await assistance.
            </Text>
          </View>
        )}

        {alerts.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>RECENT ALERTS</Text>
            {alerts.map((a) => (
              <StatusCard
                key={a.alertId}
                title={a.severity.toUpperCase()}
                message={a.message}
                severity={a.severity}
                timestamp={new Date(a.createdAt).toLocaleString()}
              />
            ))}
          </>
        )}

        <View style={styles.footer}>
          <PrimaryButton
            label="Back to Home"
            variant="secondary"
            onPress={() => router.push('/(bangkero)/home')}
          />
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl },
  back: { color: colors.primary, fontSize: 14, fontWeight: '600', marginBottom: spacing.lg },
  eyebrow: { ...typography.label, marginBottom: 2 },
  title: { ...typography.h1, marginBottom: spacing.xl },

  sosWrap: { alignItems: 'center', marginVertical: spacing.xxl },
  sosButton: {
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  sosPressed: { opacity: 0.8 },
  sosSent: { backgroundColor: colors.primaryDark },
  sosText: {
    color: colors.text,
    fontSize: 36,
    fontWeight: '900',
    letterSpacing: 2,
  },
  sosLabel: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    fontSize: 14,
  },

  sentBanner: {
    backgroundColor: 'rgba(52,214,176,0.12)',
    borderColor: colors.primary,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.lg,
    marginBottom: spacing.xl,
  },
  sentBannerText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 20,
  },

  sectionLabel: { ...typography.label, marginTop: spacing.xl, marginBottom: spacing.md },
  footer: { marginTop: spacing.xxl },
});
