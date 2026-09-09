import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { PrimaryButton } from '@/components/PrimaryButton';
import { ScreenContainer } from '@/components/ScreenContainer';
import { StarRating } from '@/components/StarRating';
import { useAuth } from '@/hooks/useAuth';
import { useRatings } from '@/hooks/useRatings';
import { colors, radii, spacing, typography } from '@/theme/tokens';

export default function RateTripScreen() {
  const { bookingId, bangkeroName, boatName } = useLocalSearchParams<{
    bookingId: string;
    bangkeroName: string;
    boatName: string;
  }>();

  const { user } = useAuth();
  const { submitRating } = useRatings(user?.id ?? null);

  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!user || !bookingId || rating === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      await submitRating({
        score: rating,
        comment: comment.trim() || null,
        bookingId,
        userId: user.id,
        bangkeroId: bangkeroName ?? '',
      });
      setSubmitted(true);
    } catch (e) {
      setError((e as Error).message || 'Failed to submit rating.');
    }
    setSubmitting(false);
  }

  if (submitted) {
    return (
      <ScreenContainer>
        <View style={styles.center}>
          <Text style={styles.thanksIcon}>⭐</Text>
          <Text style={styles.thanksTitle}>Thank you!</Text>
          <Text style={styles.thanksMsg}>
            Your rating has been submitted. It helps us improve the BangkaGo experience.
          </Text>
          <PrimaryButton
            label="Back to Home"
            onPress={() => router.replace('/(passenger)/home')}
            style={styles.thanksBtn}
          />
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer padded={false}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.back} onPress={() => router.back()}>← Back</Text>
        <Text style={styles.eyebrow}>RATE TRIP</Text>
        <Text style={styles.title}>How was your trip?</Text>

        {/* Bangkero info */}
        <View style={styles.infoCard}>
          <Text style={styles.infoLabel}>BANGKERO</Text>
          <Text style={styles.infoValue}>{bangkeroName ?? 'Unknown'}</Text>
          {boatName && (
            <>
              <Text style={[styles.infoLabel, { marginTop: spacing.md }]}>BOAT</Text>
              <Text style={styles.infoValue}>{boatName}</Text>
            </>
          )}
        </View>

        {/* Star rating */}
        <View style={styles.ratingSection}>
          <Text style={styles.ratingLabel}>Your Rating</Text>
          <StarRating rating={rating} interactive onRate={setRating} size={36} />
          {rating > 0 && (
            <Text style={styles.ratingHint}>
              {rating === 5 ? 'Excellent!' : rating === 4 ? 'Great!' : rating === 3 ? 'Okay' : rating === 2 ? 'Poor' : 'Terrible'}
            </Text>
          )}
        </View>

        {/* Comment */}
        <View style={styles.commentSection}>
          <Text style={styles.commentLabel}>Comment (optional)</Text>
          <TextInput
            style={styles.commentInput}
            placeholder="Share your experience..."
            placeholderTextColor={colors.textMuted}
            value={comment}
            onChangeText={setComment}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
            maxLength={300}
          />
        </View>

        {/* Error */}
        {!!error && (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>{error}</Text>
          </View>
        )}

        {/* Submit */}
        <PrimaryButton
          label="Submit Rating"
          onPress={handleSubmit}
          loading={submitting}
          disabled={rating === 0}
        />
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl, flexGrow: 1 },
  back: { color: colors.primary, fontSize: 14, fontWeight: '600', marginBottom: spacing.lg },
  eyebrow: { ...typography.label, marginBottom: 2 },
  title: { ...typography.h1, marginBottom: spacing.xl },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl },

  infoCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
    marginBottom: spacing.xl,
  },
  infoLabel: { ...typography.label, marginBottom: spacing.xs },
  infoValue: { color: colors.text, fontSize: 16, fontWeight: '700' },

  ratingSection: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
    marginBottom: spacing.xl,
    alignItems: 'center',
  },
  ratingLabel: { ...typography.label, marginBottom: spacing.md },
  ratingHint: { color: colors.primary, fontSize: 14, fontWeight: '600', marginTop: spacing.md },

  commentSection: { marginBottom: spacing.xl },
  commentLabel: { ...typography.label, marginBottom: spacing.sm },
  commentInput: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
    color: colors.text,
    fontSize: 15,
    minHeight: 100,
  },

  banner: {
    backgroundColor: 'rgba(224,82,82,0.12)',
    borderColor: colors.danger,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  bannerText: { color: colors.danger, fontSize: 13, lineHeight: 18 },

  thanksIcon: { fontSize: 48, marginBottom: spacing.lg },
  thanksTitle: { ...typography.h1, textAlign: 'center', marginBottom: spacing.md },
  thanksMsg: { ...typography.caption, textAlign: 'center', marginBottom: spacing.xxl },
  thanksBtn: { minWidth: 200 },
});
