import { router, useLocalSearchParams } from 'expo-router';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { useEffect, useRef, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { BangkeroScreenHeader } from '@/components/BangkeroScreenHeader';
import { Icon } from '@/components/Icon';
import { sailsLabel, todayIso } from '@/components/SchedulePicker';
import { PrimaryButton } from '@/components/PrimaryButton';
import { ScreenContainer } from '@/components/ScreenContainer';
import { LoadingState, ErrorState, EmptyState } from '@/components/States';
import { StatusPill } from '@/components/StatusPill';
import { useAuth } from '@/hooks/useAuth';
import { useBangkero, useBooking, usePorts } from '@/hooks/useSupabase';
import {
  acceptBooking, rejectBooking, friendlyError, resolveGroupNoShow, setOnboarded,
  setPassengerBoarded, verifyBoardingQr,
} from '@/services/booking.service';
import { getIslandPackage } from '@/services/island-package.service';
import { createNotification, scheduleLocalNotification } from '@/services/notification.service';
import { getPassengerDetailsByBooking } from '@/services/passenger-detail.service';
import { colors, radii, spacing, typography } from '@/theme/tokens';
import type { IslandPackageDoc, PassengerDetailDoc } from '@/types/models';
import { formatPhone } from '@/utils/phone';
import { safeBack } from '@/utils/navigation';

export default function BookingStatus() {
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();
  const { user } = useAuth();
  const { data: booking, loading, error } = useBooking(bookingId ?? null);
  const bangkero = useBangkero(user?.id ?? null);
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const uid = user?.id ?? null;
  const ports = usePorts();

  // Island-hop bookings: show every stop so the crew knows the full run.
  const [pkg, setPkg] = useState<IslandPackageDoc | null>(null);
  useEffect(() => {
    if (!booking?.packageId) return;
    let alive = true;
    getIslandPackage(booking.packageId)
      .then((p) => { if (alive) setPkg(p); })
      .catch(() => {});
    return () => { alive = false; };
  }, [booking?.packageId]);

  /**
   * Latched the moment a no-show lands. The row flips to cancelled a beat
   * later through realtime — without this, a second tap re-runs the RPC.
   */
  const [noShowDone, setNoShowDone] = useState(false);
  /** B7: counter-report sent for the current dispute — latch the button. */
  const [counterSent, setCounterSent] = useState(false);

  // Companions ride under the booker as one boarding group. Re-fetched after
  // a partial no-show (022) so absent companions show their stamped state.
  const [companions, setCompanions] = useState<PassengerDetailDoc[]>([]);
  useEffect(() => {
    if (!bookingId) return;
    let alive = true;
    getPassengerDetailsByBooking(bookingId)
      .then((rows) => { if (alive) setCompanions(rows); })
      .catch(() => {
        // the tree still renders the booker without names
      });
    return () => { alive = false; };
  }, [bookingId, noShowDone]);

  // Optimistic boarding state; the server value catches up through realtime.
  const [boardOverride, setBoardOverride] = useState<boolean | null>(null);
  useEffect(() => { setBoardOverride(null); }, [booking?.onboardedAt]);
  const boarded = boardOverride ?? !!booking?.onboardedAt;
  const [boardPending, setBoardPending] = useState(false);

  // Booker resolved = confirmed aboard, OR reported NOT aboard (022 dispute),
  // OR marked absent while companions sailed (022 partial no-show).
  const bookerResolved = boarded || !!booking?.disputedAt || !!booking?.noShowAt;
  /** Everyone resolved = booker resolved + every companion boarded or no-showed. */
  const companionsResolved = companions.every((c) => c.boardedAt || c.noShowAt);

  // Advance/slot bookings (020): the accepted row sits until its sailing
  // time — Start Trip and no-show both stay locked until the slot arrives.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(timer);
  }, []);
  const scheduledAt =
    booking?.scheduledDate && booking?.scheduledTime
      ? new Date(`${booking.scheduledDate}T${booking.scheduledTime}:00`).getTime()
      : null;
  const advanceLocked = scheduledAt !== null && now < scheduledAt;
  const canStart = bookerResolved && companionsResolved && !advanceLocked;

  // QR scanner: one scan at a time — `scanLatch` releases ONLY when the
  // scanner reopens, never after a success: the fade-out Modal keeps the
  // camera mounted, so a second QR in frame would otherwise double-fire
  // the RPC in the gap.
  const [scanOpen, setScanOpen] = useState(false);
  const [scanBusy, setScanBusy] = useState(false);
  const [scanMessage, setScanMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const scanLatch = useRef(false);
  // Frame rect in the camera view's coordinate space, from onLayout on the
  // green square — only QRs whose centre falls inside it count.
  // ponytail: portrait demo only — a rotation would need a re-measure
  const frameRect = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  // ponytail: scanned payloads are remembered per booking-screen visit —
  // one QR = one check-in, ever; revisiting the booking resets the page.
  const scannedRef = useRef<Set<string>>(new Set());
  const scanRetryRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Free the camera after a cooldown so an error/duplicate doesn't wedge it. */
  function armScanRetry() {
    if (scanRetryRef.current) clearTimeout(scanRetryRef.current);
    scanRetryRef.current = setTimeout(() => {
      scanLatch.current = false;
      setScanBusy(false);
      scanRetryRef.current = null;
    }, 800);
  }

  useEffect(
    () => () => {
      if (scanRetryRef.current) clearTimeout(scanRetryRef.current);
    },
    []
  );

  /** Manual tick for one companion row (undo with a second tap). */
  async function toggleCompanion(c: PassengerDetailDoc) {
    const next = !c.boardedAt;
    const prevIso = c.boardedAt;
    setCompanions((rows) =>
      rows.map((x) =>
        x.passengerId === c.passengerId
          ? { ...x, boardedAt: next ? new Date().toISOString() : null }
          : x
      )
    );
    try {
      await setPassengerBoarded(c.passengerId, next ? 'boarded' : 'pending');
    } catch (e) {
      setCompanions((rows) =>
        rows.map((x) =>
          x.passengerId === c.passengerId ? { ...x, boardedAt: prevIso } : x
        )
      );
      setActionError(friendlyError(e));
    }
  }

  async function handleScan(result: BarcodeScanningResult) {
    // Only the square counts. Bounds arrive in the camera view's coordinate
    // space — the same one onLayout reports for the frame. Some platforms
    // report an empty box; fail open so scanning keeps working there.
    const b = result.bounds;
    if (frameRect.current && b && b.size.width > 0 && b.size.height > 0) {
      const cx = b.origin.x + b.size.width / 2;
      const cy = b.origin.y + b.size.height / 2;
      const f = frameRect.current;
      const m = 12;
      if (cx < f.x - m || cx > f.x + f.w + m || cy < f.y - m || cy > f.y + f.h + m) return;
    }
    if (scanLatch.current) return;
    scanLatch.current = true;
    setScanBusy(true);

    // Same QR again — say it ON the camera screen, fire nothing.
    if (scannedRef.current.has(result.data)) {
      setScanMessage({
        ok: false,
        text: 'QR code already scanned — that passenger is already checked in.',
      });
      armScanRetry();
      return;
    }

    // Companion payloads are 'PAX'+token; anything else must be the booking
    // ref. Branch on the SHAPE — the old code fell back to "booker" whenever
    // the local companion list was stale, so scanning a companion ticked the
    // wrong row. The RPC stamps the correct row server-side; the refetch
    // below just brings the list back in sync.
    const isCompanionPayload = result.data.startsWith('PAX');
    const isBookerPayload =
      !!booking?.ref && result.data.toUpperCase() === booking.ref.toUpperCase();

    if (!isCompanionPayload && !isBookerPayload) {
      setScanMessage({ ok: false, text: 'That QR code does not belong to this trip.' });
      armScanRetry();
      return;
    }

    try {
      const name = await verifyBoardingQr(result.data);
      scannedRef.current.add(result.data);

      if (isCompanionPayload) {
        let hit = companions.find((c) => `PAX${c.qrToken}` === result.data);
        if (!hit) {
          // List was stale — refetch, then match again before giving up.
          try {
            const fresh = await getPassengerDetailsByBooking(bookingId);
            setCompanions(fresh);
            hit = fresh.find((c) => `PAX${c.qrToken}` === result.data);
          } catch {
            // fall through to the not-on-this-trip message
          }
        }
        if (!hit) {
          setScanMessage({ ok: false, text: 'That QR code is not on this trip.' });
          armScanRetry();
          return;
        }
        const pid = hit.passengerId;
        setCompanions((rows) =>
          rows.map((x) =>
            x.passengerId === pid ? { ...x, boardedAt: new Date().toISOString() } : x
          )
        );
      } else {
        // The booker's ticket — the RPC stamped bookings.onboarded_at.
        setBoardOverride(true);
      }
      setScanMessage({ ok: true, text: `${name} checked in` });
      setScanOpen(false);
      // Latch STAYS engaged — openScanner() is the only release point.
    } catch (e) {
      setScanMessage({ ok: false, text: friendlyError(e) });
      armScanRetry();
    }
  }

  async function openScanner() {
    if (scanRetryRef.current) {
      clearTimeout(scanRetryRef.current);
      scanRetryRef.current = null;
    }
    setScanMessage(null);
    if (!permission?.granted) {
      const res = await requestPermission();
      if (!res.granted) {
        setScanMessage({ ok: false, text: 'Camera access is needed to scan boarding passes.' });
        return;
      }
    }
    scanLatch.current = false;
    setScanBusy(false);
    setScanOpen(true);
  }

  const isCargo = booking?.serviceType === 'cargo';

  async function handleAccept() {
    if (!uid || !booking) return;
    setPending(true);
    setActionError(null);
    try {
      await acceptBooking(booking.bookingId, {
        uid,
        displayName: bangkero.data?.displayName ?? '',
      });
      // Confirmation both ways: the passenger learns the trip is set (with
      // its sail slot), and the bangkero's pocket ping says what they took.
      const sails = sailsLabel(booking.scheduledDate, booking.scheduledTime);
      const advance = !!booking.scheduledDate && booking.scheduledDate > todayIso();
      if (booking.userId) {
        createNotification(
          booking.userId,
          'Booking Accepted',
          `Your trip ${booking.ref} was accepted.${sails ? ` Sails ${sails}.` : ''}`
        ).catch(() => {});
      }
      scheduleLocalNotification(
        advance ? 'Advance trip confirmed' : 'Passengers are waiting',
        advance
          ? `Your boat sails ${sails} — ${booking.fromPortName} → ${booking.toPortName}.`
          : `Your passengers are waiting at ${booking.fromPortName}. Stay online to reach them.`
      ).catch(() => {});
    } catch (e) {
      setActionError(friendlyError(e));
    }
    setPending(false);
  }

  async function toggleBoarded(next: boolean) {
    if (!booking) return;
    setBoardPending(true);
    setActionError(null);
    try {
      await setOnboarded(booking.bookingId, next);
      setBoardOverride(next);
      if (next) {
        // Confirmation both ways: if the passenger is actually still on the
        // pier, this is their cue to shout before the boat leaves.
        createNotification(
          booking.userId,
          'You are confirmed on board',
          `The crew confirmed everyone on ${booking.ref} is aboard. If you are NOT on board, open this booking and tap "I'm NOT on board" right away.`
        ).catch(() => {});
        scheduleLocalNotification(
          'Passengers confirmed aboard',
          `Everyone on ${booking.ref} is on board — you're clear to depart.`
        ).catch(() => {});
      }
    } catch (e) {
      setActionError(friendlyError(e));
    }
    setBoardPending(false);
  }

  function confirmNoShow() {
    if (!booking || noShowDone) return;
    Alert.alert(
      'Passenger(s) didn’t board',
      `The boat leaves with everyone who boarded on ${booking.ref}. If nobody from this booking boarded, it is cancelled as a no-show and the booker is banned for a while — otherwise only the missing passengers are marked and the trip continues.`,
      [
        { text: 'Go back', style: 'cancel' },
        { text: 'Mark no-show', style: 'destructive', onPress: () => void handleNoShow() },
      ]
    );
  }

  async function handleNoShow() {
    if (!booking || noShowDone) return;
    setBoardPending(true);
    setActionError(null);
    try {
      await resolveGroupNoShow(booking);
      setNoShowDone(true);
    } catch (e) {
      setActionError(friendlyError(e));
    }
    setBoardPending(false);
  }

  /**
   * B7 counter-report: the passenger filed a not-aboard dispute — the
   * bangkero gets one fixed-response line to their record.
   */
  function confirmCounterReport() {
    if (!booking?.userId) return;
    Alert.alert(
      'Counter-report',
      `Tell ${booking.passengerName ?? 'the passenger'} you dispute their report? They are notified that the boat waited and their party was called to board.`,
      [
        { text: 'Go back', style: 'cancel' },
        {
          text: 'Send counter-report',
          onPress: () => {
            createNotification(
              booking.userId,
              'Bangkero counters your report',
              `The captain disputes your not-aboard report on ${booking.ref}: the boat waited at ${booking.fromPortName} and your party was called to board. Coastguard will review both statements.`
            )
              .then(() => setCounterSent(true))
              .catch(() => setActionError('Could not send the counter-report — try again.'));
          },
        },
      ]
    );
  }

  async function handleDecline() {
    if (!uid || !booking) return;
    setPending(true);
    setActionError(null);
    try {
      await rejectBooking(booking.bookingId);
      safeBack('/(bangkero)/home');
    } catch (e) {
      setActionError(friendlyError(e));
    }
    setPending(false);
  }

  async function handleStartTrip() {
    router.push('/(bangkero)/departure');
  }

  function handleContactPassenger() {
    if (booking?.passengerPhone) {
      const phone = booking.passengerPhone.replace('+', '');
      router.push(`tel:${phone}`);
    }
  }

  return (
    <ScreenContainer padded={false}>
      <BangkeroScreenHeader title="Booking Status" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {loading ? (
          <LoadingState label="Loading booking…" />
        ) : error ? (
          <ErrorState message={error} />
        ) : !booking ? (
          <EmptyState icon="📋" title="Not found" message="This booking could not be loaded." />
        ) : (
          <>
            <View style={styles.refCard}>
              <View style={styles.refTop}>
                <Text style={styles.refText}>{booking.ref}</Text>
                <StatusPill status={booking.status} />
              </View>
              <View style={styles.refRoute}>
                <Text style={styles.refPort} numberOfLines={1}>{booking.fromPortName}</Text>
                <Text style={styles.refArrow}>→</Text>
                <Text style={styles.refPort} numberOfLines={1}>{booking.toPortName}</Text>
              </View>
            </View>

            {!!pkg && pkg.stops.length > 1 && (
              <View style={styles.card}>
                <Text style={styles.cardLabel}>ITINERARY · {pkg.packageName.toUpperCase()}</Text>
                {pkg.stops.map((stopId, i) => (
                  <Text key={`${stopId}-${i}`} style={styles.itineraryStop} numberOfLines={1}>
                    {i + 1}. {ports.data.find((p) => p.portId === stopId)?.portName ?? stopId}
                  </Text>
                ))}
              </View>
            )}

            {booking.status === 'accepted' && !!booking.disputedAt && (
              <View style={styles.banner}>
                <Text style={styles.bannerText}>
                  {booking.passengerName ?? 'The passenger'} reports they were NOT on board. The trip continues — tick who actually sailed, then Start Trip.
                </Text>
              </View>
            )}

            <View style={styles.card}>
              <Text style={styles.cardLabel}>PASSENGER INFO</Text>
              <Text style={styles.cardValue} numberOfLines={1}>{booking.passengerName ?? 'N/A'}</Text>
              <Text style={styles.cardSub}>
                {booking.passengerPhone ? formatPhone(booking.passengerPhone) : ''}
              </Text>
              <Text style={styles.cardSub} numberOfLines={1}>{booking.numOfPassenger} pax · ₱{booking.totalPrice}</Text>
            </View>

            {!!actionError && (
              <View style={styles.banner}>
                <Text style={styles.bannerText}>{actionError}</Text>
              </View>
            )}

            {booking.status === 'accepted' && (
              <View style={styles.card}>
                <Text style={styles.cardLabel}>{isCargo ? 'CARGO READY' : 'PASSENGERS ON BOARD'}</Text>
                {/* The booker speaks for the party; every companion gets its
                    own tick so the crew can see exactly who is aboard. */}
                <Pressable
                  onPress={() => toggleBoarded(!boarded)}
                  disabled={boardPending}
                  style={({ pressed }) => [styles.boardRow, pressed && styles.boardRowPressed]}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: boarded }}
                  accessibilityLabel={isCargo ? 'Cargo loaded' : 'Passengers on board'}
                >
                  <View style={[styles.checkbox, boarded && styles.checkboxOn]}>
                    {boarded && <Icon name="check" size={14} color={colors.primaryText} />}
                  </View>
                  <View style={styles.boardText}>
                    <Text style={styles.boardName} numberOfLines={1}>
                      {booking.passengerName ?? 'Passengers'}
                    </Text>
                    <Text style={styles.boardSub}>
                      {isCargo
                        ? `Cargo trip · ${boarded ? 'loaded' : 'not loaded yet'}`
                        : booking.disputedAt
                          ? 'Reported NOT aboard — trip continues'
                          : `Booker · ${boarded ? 'confirmed aboard' : 'not confirmed yet'}`}
                    </Text>
                  </View>
                </Pressable>
                {companions.map((c) => (
                  <Pressable
                    key={c.passengerId}
                    onPress={() => void toggleCompanion(c)}
                    style={({ pressed }) => [styles.boardRow, pressed && styles.boardRowPressed]}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: !!c.boardedAt }}
                    accessibilityLabel={`${c.firstName} ${c.lastName} on board`}
                  >
                    <View style={[styles.checkbox, c.boardedAt && styles.checkboxOn]}>
                      {c.boardedAt && <Icon name="check" size={14} color={colors.primaryText} />}
                    </View>
                    <View style={styles.boardText}>
                      <Text style={styles.boardName} numberOfLines={1}>
                        {c.firstName} {c.lastName}
                        {c.passengerType !== 'regular' ? ` (${c.passengerType})` : ''}
                      </Text>
                      <Text style={styles.boardSub}>
                        {c.noShowAt
                          ? 'Marked no-show'
                          : c.boardedAt
                            ? 'Boarded'
                            : 'Not boarded yet'}
                      </Text>
                    </View>
                  </Pressable>
                ))}
                <PrimaryButton
                  label="Scan boarding QR"
                  variant="secondary"
                  onPress={() => void openScanner()}
                  style={styles.scanBtn}
                />
              </View>
            )}

            {!!scanMessage && (
              <View style={[styles.banner, scanMessage.ok && styles.bannerOk]}>
                <Text style={[styles.bannerText, scanMessage.ok && styles.bannerOkText]}>
                  {scanMessage.text}
                </Text>
              </View>
            )}

            <View style={styles.actions}>
              {booking.status === 'open' && (
                <>
                  <PrimaryButton
                    label="Decline"
                    variant="secondary"
                    onPress={handleDecline}
                    loading={pending}
                    style={styles.actionBtn}
                  />
                  <PrimaryButton
                    label="Accept"
                    onPress={handleAccept}
                    loading={pending}
                    style={styles.actionBtn}
                  />
                </>
              )}

              {booking.status === 'accepted' && (
                <>
                  <PrimaryButton
                    label="Contact Passenger"
                    variant="secondary"
                    onPress={handleContactPassenger}
                    style={styles.actionBtn}
                  />
                  <PrimaryButton
                    label="Start Trip"
                    onPress={handleStartTrip}
                    loading={pending}
                    disabled={!canStart}
                    style={styles.actionBtn}
                  />
                </>
              )}

              {booking.status === 'completed' && (
                <PrimaryButton
                  label="View Summary"
                  onPress={() => router.push('/(bangkero)/trip-summary')}
                />
              )}
            </View>

            {/* B7 — the passenger filed a not-aboard dispute; one reply. */}
            {booking.status === 'accepted' && !!booking.disputedAt && (
              <PrimaryButton
                label={counterSent ? 'Counter-report sent' : 'Counter-report passenger'}
                variant="danger"
                onPress={confirmCounterReport}
                disabled={counterSent}
                style={{ marginTop: spacing.md }}
              />
            )}

            {booking.status === 'accepted' && !canStart && (
              <>
                <Text style={styles.gateHint}>
                  {advanceLocked
                    ? `Scheduled sail: ${booking.scheduledDate} ${booking.scheduledTime} — Start Trip opens when the slot arrives.`
                    : isCargo
                      ? 'Confirm the cargo is loaded to start the trip.'
                      : bookerResolved && !companionsResolved
                        ? 'Tick every passenger who is aboard to start the trip.'
                        : 'Confirm everyone is on board to start the trip.'}
                </Text>
                {/* Nobody missed a boat that has not left yet. */}
                {!advanceLocked && (
                  <PrimaryButton
                    label={noShowDone ? 'No-show marked' : 'Passenger(s) didn’t board'}
                    variant="danger"
                    onPress={confirmNoShow}
                    loading={boardPending}
                    disabled={noShowDone}
                    style={styles.noShowBtn}
                  />
                )}
              </>
            )}
          </>
        )}
      </ScrollView>

      {/* One scanner for the whole party — the bangkero reopens it per
          passenger so a frame burst can never double-fire the RPC. */}
      <Modal visible={scanOpen} animationType="fade" onRequestClose={() => setScanOpen(false)}>
        <View style={styles.scanWrap}>
          {permission?.granted ? (
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={scanBusy ? undefined : handleScan}
            />
          ) : (
            <LoadingState label="Requesting camera…" />
          )}
          <View style={styles.scanOverlay}>
            <View
              style={styles.scanFrame}
              onLayout={(e) => {
                const { x, y, width, height } = e.nativeEvent.layout;
                frameRect.current = { x, y, w: width, h: height };
              }}
            />
            <Text style={styles.scanHint}>
              Point at the passenger&apos;s boarding QR code
            </Text>
            {/* Feedback where the bangkero is actually looking — the outer
                banner sits behind this modal while the camera is open. */}
            {!!scanMessage && (
              <View
                style={[
                  styles.scanMsg,
                  scanMessage.ok ? styles.scanMsgOk : styles.scanMsgErr,
                ]}
              >
                <Text
                  style={
                    scanMessage.ok ? styles.scanMsgOkText : styles.scanMsgErrText
                  }
                >
                  {scanMessage.text}
                </Text>
              </View>
            )}
            <PrimaryButton
              label="Close"
              variant="secondary"
              onPress={() => setScanOpen(false)}
              style={styles.scanClose}
            />
          </View>
        </View>
      </Modal>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl },

  eyebrow: { ...typography.label, marginBottom: 2 },
  title: { ...typography.h1, marginBottom: spacing.xl },

  refCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  refTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  refText: { flexShrink: 1, color: colors.textMuted, fontSize: 11, letterSpacing: 0.5 },
  refRoute: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  refPort: { flexShrink: 1, color: colors.text, fontSize: 15, fontWeight: '700' },
  refArrow: { color: colors.primary, fontSize: 15, fontWeight: '700' },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  cardLabel: { ...typography.label, marginBottom: spacing.sm },
  cardValue: { flexShrink: 1, color: colors.text, fontSize: 15, fontWeight: '700' },
  cardSub: { flexShrink: 1, ...typography.caption, color: colors.textMuted, marginTop: spacing.xs },
  itineraryStop: { flexShrink: 1, color: colors.text, fontSize: 14, fontWeight: '600', lineHeight: 22 },

  banner: {
    backgroundColor: colors.dangerTint,
    borderColor: colors.danger,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  bannerText: { flexShrink: 1, color: colors.danger, fontSize: 13, lineHeight: 18 },
  bannerOk: { backgroundColor: colors.successTint, borderColor: colors.success },
  bannerOkText: { color: colors.success },

  actions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm },
  actionBtn: { flex: 1 },

  // ---------- boarding checkbox ----------
  boardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  boardRowPressed: { opacity: 0.7 },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: radii.xs,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  boardText: { flex: 1, minWidth: 0 },
  boardName: { flexShrink: 1, color: colors.text, fontSize: 15, fontWeight: '700' },
  boardSub: { flexShrink: 1, ...typography.caption, color: colors.textMuted, marginTop: 2 },
  scanBtn: { marginTop: spacing.md },

  // ---------- QR scanner ----------
  scanWrap: { flex: 1, backgroundColor: '#000' },
  scanOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.lg,
  },
  scanFrame: {
    width: 220,
    height: 220,
    borderRadius: radii.md,
    borderWidth: 2,
    borderColor: colors.primary,
    backgroundColor: 'transparent',
  },
  scanHint: { ...typography.caption, color: '#fff', textAlign: 'center' },
  scanMsg: {
    alignSelf: 'stretch',
    borderRadius: radii.md,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: 'rgba(0,0,0,0.75)',
  },
  scanMsgOk: { borderColor: colors.primary },
  scanMsgErr: { borderColor: colors.danger },
  scanMsgOkText: { color: '#fff', fontSize: 13, textAlign: 'center', fontWeight: '600' },
  scanMsgErrText: { color: '#ffd9d9', fontSize: 13, textAlign: 'center', fontWeight: '600' },
  scanClose: { marginTop: spacing.lg, alignSelf: 'stretch' },

  gateHint: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.md,
  },
  noShowBtn: { marginTop: spacing.sm },
});
