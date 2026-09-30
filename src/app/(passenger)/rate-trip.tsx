import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { PassengerScreenHeader } from '@/components/PassengerScreenHeader';
import { PrimaryButton } from '@/components/PrimaryButton';
import { ScreenContainer } from '@/components/ScreenContainer';
import { StarRating } from '@/components/StarRating';
import { ErrorState, LoadingState } from '@/components/States';
import { useAuth } from '@/hooks/useAuth';
import { useBooking } from '@/hooks/useSupabase';
import { friendlyError } from '@/services/booking.service';
import { getRatingsByBooking, submitRating } from '@/services/rating.service';
import type { RatingDoc } from '@/types/models';
import { colors, radii, spacing, typography } from '@/theme/tokens';

/**
 * Rate a COMPLETED trip. The booking id is the source of truth: the
 * bangkero UUID comes from booking.operator_id (013's unique index
 * makes a second submit fail loudly instead of double-writing).
 */
export default function RateTripScreen() {
  const { bookingId, bangkeroName, boatName } = useLocalSearchParams<{
    bookingId: string;
    bangkeroName?: string;
    boatName?: string;
  }>();

  const { user } = useAuth();
  const { data: booking, loading, error } = useBooking(bookingId ?? null);

  const [existing, setExisting] = useState<RatingDoc | null>(null);
  const [existingChecked, setExistingChecked] = useState(false);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Already rated? Load once the booking is known.
  useEffect(() => {
    if (!bookingId || !user?.id) return;
    let alive = true;
    getRatingsByBooking(bookingId)
      .then((rows) => {
        if (!alive) return;
        setExisting(rows.find((r) => r.userId === user.id) ?? null);
        setExistingChecked(true);
      })
      .catch(() => {
        // A missed check only costs the guard — submit still enforces
        // the unique index (013).
        if (alive) setExistingChecked(true);
      });
    return () => {
      alive = false;
    };
  }, [bookingId, user?.id]);

  async function handleSubmit() {
    if (!user || !bookingId || !booking) return;
    if (booking.status !== 'completed') {
      setActionError('Only completed trips can be rated.');
      return;
    }
    if (!booking.operatorId) {
      setActionError('This trip has no bangkero to rate.');
      return;
    }
    if (existing) {
      setActionError('You already rated this trip.');
      return;
    }
    if (rating === 0) {
      setActionError('Pick a star rating first.');
      return;
    }
    setSubmitting(true);
    setActionError(null);
    try {
      await submitRating({
        score: rating,
        comment: comment.trim() || undefined,
        bookingId,
        userId: user.id,
        bangkeroId: booking.operatorId,
      });
      setSubmitted(true);
    } catch (e) {
      const msg = friendlyError(e);
      // The unique index (013) or a lost race lands here.
      if (/already rated|duplicate key/i.test(msg) || /duplicate key/i.test((e as Error).message ?? '')) {
        setActionError('You already rated this trip.');
      } else {
        setActionError(msg);
      }
    }
    setSubmitting(false);
  }

  if (loading) {
    return <ScreenContainer><LoadingState label="Loading trip…" /></ScreenContainer>;
  }
  if (error) {
    return <ScreenContainer><ErrorState message={error} /></ScreenContainer>;
  }
  if (!booking) {
    return <ScreenContainer><ErrorState message="Booking not found." /></ScreenContainer>;
  }

  const infoName = booking.operatorName ?? bangkeroName ?? 'Unknown';
  const infoBoat = booking.operatorBoatName ?? boatName;

  if (submitted) {
    return (
      <ScreenContainer padded={false}>
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

  if (existing) {
    return (
      <ScreenContainer padded={false}>
        <PassengerScreenHeader title="Rate Trip" subtitle="RATE TRIP" />
        <View style={styles.center}>
          <Text style={styles.thanksIcon}>⭐</Text>
          <Text style={styles.thanksTitle}>Already rated</Text>
          <View style={styles.existingStars}>
            <StarRating rating={existing.score} size={28} />
          </View>
          {!!existing.comment && <Text style={styles.thanksMsg}>{existing.comment}</Text>}
          <PrimaryButton
            label="Back to home"
            variant="secondary"
            onPress={() => router.replace('/(passenger)/home')}
            style={styles.thanksBtn}
          />
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer padded={false}>
      <PassengerScreenHeader title="Rate Trip" subtitle="RATE TRIP" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* Bangkero info */}
        <View style={styles.infoCard}>
          <Text style={styles.infoLabel}>BANGKERO</Text>
          <Text style={styles.infoValue}>{infoName}</Text>
          {!!infoBoat && (
            <>
              <Text style={[styles.infoLabel, { marginTop: spacing.md }]}>BOAT</Text>
              <Text style={styles.infoValue} numberOfLines={1}>{infoBoat}</Text>
            </>
          )}
          <Text style={styles.infoTrip} numberOfLines={1}>
            {booking.fromPortName} → {booking.toPortName} · {booking.ref}
          </Text>
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
        {!!actionError && (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>{actionError}</Text>
          </View>
        )}

        {/* Submit */}
        <PrimaryButton
          label={submitting ? 'Submitting…' : 'Submit Rating'}
          onPress={handleSubmit}
          loading={submitting}
          disabled={rating === 0 || submitting}
        />
        {!existingChecked && (
          <Text style={styles.checkNote}>Checking your past ratings…</Text>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl, flexGrow: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl, paddingVertical: spacing.xxl },

  infoCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
    marginTop: spacing.lg,
    marginBottom: spacing.xl,
  },
  infoLabel: { ...typography.label, marginBottom: spacing.xs },
  infoValue: { flexShrink: 1, color: colors.text, fontSize: 16, fontWeight: '700' },
  infoTrip: { color: colors.textMuted, fontSize: 12, marginTop: spacing.md },

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
  ratingHint: { flexShrink: 1, color: colors.primary, fontSize: 14, fontWeight: '600', marginTop: spacing.md },

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
    backgroundColor: colors.dangerTint,
    borderColor: colors.danger,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  bannerText: { flexShrink: 1, color: colors.danger, fontSize: 13, lineHeight: 18 },

  thanksIcon: { fontSize: 48, marginBottom: spacing.lg },
  thanksTitle: { ...typography.h1, textAlign: 'center', marginBottom: spacing.md },
  thanksMsg: { ...typography.caption, textAlign: 'center', marginBottom: spacing.xxl },
  thanksBtn: { minWidth: 200 },
  existingStars: { marginBottom: spacing.lg },
  checkNote: { color: colors.textMuted, fontSize: 12, textAlign: 'center', marginTop: spacing.md },
});
