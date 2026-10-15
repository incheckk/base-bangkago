import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { BangkeroScreenHeader } from '@/components/BangkeroScreenHeader';
import { PrimaryButton } from '@/components/PrimaryButton';
import { ScreenContainer } from '@/components/ScreenContainer';
import { useAuth } from '@/hooks/useAuth';
import { useBangkero } from '@/hooks/useSupabase';
import { friendlyError } from '@/services/booking.service';
import {
  docPublicUrl, pickImage, removeGcashQr, saveGcashQr,
} from '@/services/documents.service';
import { colors, radii, spacing, typography } from '@/theme/tokens';

/**
 * The bangkero's GCash QR — how passengers pay on board. Upload,
 * change or remove it anytime; the image lives in the public `docs`
 * bucket and its path sits on bangkeros.gcash_qr_url (011).
 * Bangkero-side only; passengers do not get a QR screen.
 */
export default function GcashQrScreen() {
  const { user } = useAuth();
  const uid = user?.id ?? null;
  const bangkero = useBangkero(uid);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Local write wins over the hook's row until realtime echoes it back.
  const [override, setOverride] = useState<string | null | undefined>(undefined);

  const path = override !== undefined
    ? override
    : bangkero.data?.gcashQrUrl ?? null;
  const url = docPublicUrl(path);

  function chooseImage() {
    const options: { text: string; style?: 'destructive' | 'cancel'; onPress?: () => void }[] = [
      { text: 'Take photo', onPress: () => void doUpload('camera') },
      { text: 'Choose from gallery', onPress: () => void doUpload('gallery') },
    ];
    if (path) {
      options.push({ text: 'Remove', style: 'destructive', onPress: () => void doRemove() });
    }
    options.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert('GCash QR', path ? 'Change or remove your QR code' : 'Add your GCash QR code', options);
  }

  async function doUpload(source: 'camera' | 'gallery') {
    if (!uid) return;
    try {
      setError(null);
      const uri = await pickImage(source);
      if (!uri) return;
      setBusy(true);
      setOverride(await saveGcashQr(uid, uri));
    } catch (e) {
      setError(friendlyError(e));
    }
    setBusy(false);
  }

  async function doRemove() {
    if (!uid) return;
    try {
      setError(null);
      setBusy(true);
      await removeGcashQr(uid);
      setOverride(null);
    } catch (e) {
      setError(friendlyError(e));
    }
    setBusy(false);
  }

  return (
    <ScreenContainer padded={false}>
      <BangkeroScreenHeader eyebrow="PAYMENTS" title="GCash QR" />
      <View style={styles.scroll}>

        <Text style={styles.hint}>
          Passengers scan this QR code to send your fare via GCash on board.
          Upload a clear screenshot of your GCash QR — you can change it anytime.
        </Text>

        <View style={styles.qrBox}>
          {url ? (
            <Image source={{ uri: url }} style={styles.qrImage} resizeMode="contain" />
          ) : (
            <View style={styles.qrPlaceholder}>
              <Text style={styles.qrText}>No QR code uploaded</Text>
              <Text style={styles.qrSub}>Upload your GCash QR code</Text>
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
            onPress={() => router.replace('/(bangkero)/home')}
          />
        </View>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
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
