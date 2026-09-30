import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { AdminScreenHeader } from '@/components/AdminScreenHeader';
import { PrimaryButton } from '@/components/PrimaryButton';
import { ScreenContainer } from '@/components/ScreenContainer';
import { clearAdminGcashQr, getAdminGcashQr, saveAdminGcashQr } from '@/services/app-settings.service';
import { friendlyError } from '@/services/booking.service';
import { pickImage } from '@/services/documents.service';
import { colors, radii, spacing, typography } from '@/theme/tokens';

/**
 * The ADMIN's escrow QR — every island-hopping and boat-rental
 * downpayment is paid to this code. Stored in app_settings (015),
 * displayed on the passenger payment screen. Bangkero GCash QRs
 * (their own per-operator codes) are unaffected.
 */
export default function AdminGcashQrScreen() {
  const [url, setUrl] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getAdminGcashQr()
      .then((v) => {
        if (alive) setUrl(v);
      })
      .catch((e) => {
        if (alive) setError(friendlyError(e));
      })
      .finally(() => {
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  function chooseImage() {
    const options: { text: string; style?: 'destructive' | 'cancel'; onPress?: () => void }[] = [
      { text: 'Take photo', onPress: () => void doUpload('camera') },
      { text: 'Choose from gallery', onPress: () => void doUpload('gallery') },
    ];
    if (url) {
      options.push({ text: 'Remove', style: 'destructive', onPress: () => void doRemove() });
    }
    options.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert('Escrow GCash QR', url ? 'Change or remove the QR code' : 'Add the escrow QR code', options);
  }

  async function doUpload(source: 'camera' | 'gallery') {
    try {
      setError(null);
      const uri = await pickImage(source);
      if (!uri) return;
      setBusy(true);
      setUrl(await saveAdminGcashQr(uri));
    } catch (e) {
      setError(friendlyError(e));
    }
    setBusy(false);
  }

  async function doRemove() {
    try {
      setError(null);
      setBusy(true);
      await clearAdminGcashQr();
      setUrl(null);
    } catch (e) {
      setError(friendlyError(e));
    }
    setBusy(false);
  }

  return (
    <ScreenContainer padded={false}>
      <AdminScreenHeader eyebrow="PAYMENTS" title="GCash QR" />
      <View style={styles.scroll}>
        <Text style={styles.hint}>
          Passengers pay their 50% downpayment for island hops and boat rentals to this QR.
          Upload a clear screenshot of the GCash account that should hold the escrow —
          you can change it anytime.
        </Text>

        <View style={styles.qrBox}>
          {url ? (
            <Image source={{ uri: url }} style={styles.qrImage} resizeMode="contain" />
          ) : (
            <View style={styles.qrPlaceholder}>
              <Text style={styles.qrText}>{loaded ? 'NO QR YET' : 'LOADING…'}</Text>
              <Text style={styles.qrSub}>Upload the escrow GCash QR code</Text>
            </View>
          )}
        </View>

        {!!error && (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>{error}</Text>
          </View>
        )}

        <Pressable
          onPress={chooseImage}
          disabled={busy}
          style={({ pressed }) => [styles.actionBtn, pressed && styles.actionBtnPressed]}
        >
          <Text style={styles.actionText}>
            {busy ? 'Saving…' : url ? 'Change / Remove QR Code' : 'Upload GCash QR'}
          </Text>
        </Pressable>

        <View style={styles.footer}>
          <PrimaryButton
            label="Back to Home"
            variant="secondary"
            onPress={() => router.replace('/(admin)/home')}
          />
        </View>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxl,
    alignItems: 'center',
  },

  hint: {
    ...typography.caption,
    color: colors.textMuted,
    lineHeight: 18,
    textAlign: 'center',
    marginBottom: spacing.xl,
  },

  qrBox: {
    width: 240,
    height: 240,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 2,
    borderColor: colors.borderSubtle,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    marginBottom: spacing.lg,
  },
  qrImage: { width: '100%', height: '100%' },
  qrPlaceholder: { alignItems: 'center', paddingHorizontal: spacing.lg },
  qrText: { color: colors.textMuted, fontSize: 16, fontWeight: '700', letterSpacing: 2 },
  qrSub: { ...typography.caption, color: colors.textMuted, marginTop: spacing.xs },

  banner: {
    width: '100%',
    backgroundColor: colors.dangerTint,
    borderColor: colors.danger,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  bannerText: { flexShrink: 1, color: colors.danger, fontSize: 13, lineHeight: 18 },

  actionBtn: {
    width: '100%',
    paddingVertical: spacing.md,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  actionBtnPressed: { opacity: 0.7 },
  actionText: { color: colors.text, fontSize: 14, fontWeight: '700' },

  footer: { width: '100%', marginTop: spacing.xxl },
});
