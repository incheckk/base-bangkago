import { router } from 'expo-router';
import * as Location from 'expo-location';
import { useEffect, useRef, useState } from 'react';
import { Dimensions, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  interpolateColor, useAnimatedStyle, useSharedValue, withSpring, withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, type IconName } from '@/components/Icon';
import { MapContainer } from '@/components/MapContainer';
import { CoachOverlay, useCoachRects, useCoachTarget, type CoachStep } from '@/components/CoachMark';
import { PrimaryButton } from '@/components/PrimaryButton';
import { SideDrawer } from '@/components/SideDrawer';
import { EmptyState, LoadingState } from '@/components/States';
import { WeatherCard } from '@/components/WeatherCard';
import { MENU_TITLE, menuFor } from '@/config/menu';
import { useAuth } from '@/hooks/useAuth';
import { useOnboarding } from '@/hooks/useOnboarding';
import { useNotifications } from '@/hooks/useNotifications';
import {
  useActiveCargoDeliveries, useAvailableBangkeroCount, usePorts, usePortQueue, useRecentBookings,
} from '@/hooks/useSupabase';
import { scheduleLocalNotification } from '@/services/notification.service';
import { formatDistance, getNearestQueuedBoatDistance, haversineM } from '@/services/queue.service';
import { supabase } from '@/services/supabase';
import { STRAIT_POINT } from '@/services/weather.service';
import { colors, elevation, numeric, radii, spacing, touchTarget, typography } from '@/theme/tokens';
import type { BookingDoc, ParcelDoc, PortDoc } from '@/types/models';

const SCREEN_H = Dimensions.get('window').height;

/**
 * Two snap points.
 *
 * The sheet is always rendered at its full expanded height and slid down by
 * `translateY` — animating a transform runs on the UI thread, whereas animating
 * `height` would relayout every frame.
 *
 * COLLAPSED shows the primary action and the service tiles only, leaving the
 * map dominant. EXPANDED brings Recent Trips into view.
 */
const SHEET_EXPANDED = Math.round(SCREEN_H * 0.72);
const SHEET_COLLAPSED = 232;
const DRAG_RANGE = SHEET_EXPANDED - SHEET_COLLAPSED;

/** Fixed height of the floating active-booking banner; the port callout stacks over it. */
const ACTIVE_BANNER_H = 64;

/**
 * Secondary services only.
 *
 * "Boat Ride" used to lead this row while the primary CTA directly below it
 * pointed at the same route — two controls, one destination, competing for the
 * same glance. The CTA keeps that job; the tiles are now strictly the other
 * three things a passenger can book.
 */
const SERVICES: { key: string; icon: IconName; label: string; enabled: boolean; route: string }[] = [
  { key: 'island', icon: 'island', label: 'Island Hop', enabled: true, route: '/(passenger)/island-packages' },
  { key: 'padala', icon: 'parcel', label: 'Padala', enabled: true, route: '/(passenger)/book-delivery' },
  { key: 'rental', icon: 'rental', label: 'Boat Rental', enabled: true, route: '/(passenger)/boat-rental' },
];

function deliveryModeLabel(parcel: ParcelDoc): string {
  // An abandoned batch auto-solos the parcel (059) without rewriting
  // delivery_type, so the batching lifecycle is the live mode.
  if (parcel.batchingStatus === 'solo') return 'Solo';
  if (parcel.deliveryType === 'batched') return 'Batched';
  if (parcel.deliveryType === 'solo') return 'Solo';
  return 'Piggyback';
}

/** Parcel lifecycle, not `trip_stat` — batched stubs are cancelled at resolve. */
function deliveryStateLabel(parcel: ParcelDoc): string {
  if (parcel.batchingStatus === 'solo') {
    return parcel.status === 'in_transit' ? 'On the way' : 'Waiting for a bangkero';
  }
  if (parcel.deliveryType === 'batched') {
    if (parcel.batchingStatus !== 'batched') return 'Waiting for other parcels';
    return parcel.batchedCountAtSail != null
      ? `Sailing with ${parcel.batchedCountAtSail} parcels`
      : 'Sailing';
  }
  if (parcel.deliveryType === 'solo') {
    return parcel.status === 'in_transit' ? 'On the way' : 'Waiting for a bangkero';
  }
  if (parcel.approvalStatus === 'pending') return 'Waiting for the captain';
  if (parcel.approvalStatus === 'rejected') return 'Not approved';
  if (parcel.approvalStatus === 'timeout') return 'Request expired';
  return parcel.status === 'in_transit' ? 'On the way' : 'With your trip';
}

function deliveryNeedsAttention(parcel: ParcelDoc): boolean {
  return parcel.deliveryType === 'piggyback' &&
    (parcel.approvalStatus === 'rejected' || parcel.approvalStatus === 'timeout');
}

/** Five taps around the real home screen — the order a passenger uses it in. */
const PASSENGER_COACH: CoachStep[] = [
  {
    target: 'p.status',
    title: 'Boats available now',
    body: 'This bar shows how many operators are online and how many are waiting at the port nearest you. If it reads zero, nobody can accept yet.',
  },
  {
    target: 'p.cta',
    title: 'Start here to book',
    body: 'Tap Book a ride to choose your departure and destination ports. The fare is set per route, so you see the price before you confirm.',
    action: 'Next',
  },
  {
    target: 'p.tiles',
    title: 'Other services',
    body: 'Island hopping, Padala parcel delivery, and whole-boat rental. Swipe sideways to see them all.',
  },
  {
    target: 'p.sheet',
    title: 'Drag for your trips',
    body: 'Pull this handle up to see your recent bookings, or down to get the full map back.',
  },
  {
    target: 'p.menu',
    title: 'Everything else lives here',
    body: 'Your bookings, rentals, profile and sign out. That is the whole app — tap Got it and book your first trip.',
  },
];

export default function PassengerHome() {
  const insets = useSafeAreaInsets();
  const { user, profile } = useAuth();
  const tour = useOnboarding(user?.id ?? null);
  const coachRects = useCoachRects();
  // Each of these marks one real control on this screen, measured where it
  // actually sits — nothing in the tutorial is a drawing of the UI.
  const tMenu = useCoachTarget('p.menu');
  const tStatus = useCoachTarget('p.status');
  const tSheet = useCoachTarget('p.sheet');
  const tCta = useCoachTarget('p.cta');
  const tTiles = useCoachTarget('p.tiles');
  const ports = usePorts();
  const bangkeros = useAvailableBangkeroCount();
  const bookings = useRecentBookings(user?.id ?? null, 10);
  const deliveries = useActiveCargoDeliveries(user?.id ?? null);
  const notifications = useNotifications(user?.id ?? null);

  // ---------- nearest port waiting line (Phase 2, 008) ----------
  // One soft foreground GPS ask on mount. Denied or no fix → the card
  // simply never renders; no nagging, no re-prompt loop.
  const [myPos, setMyPos] = useState<{ lat: number; lng: number } | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (alive) setMyPos({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      } catch {
        // no fix — the waiting segment stays hidden
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const nearPort = ((): PortDoc | null => {
    if (!myPos) return null;
    let best: PortDoc | null = null;
    let bestD = Infinity;
    for (const p of ports.data) {
      if (p.latitude == null || p.longitude == null) continue;
      const d = haversineM(myPos.lat, myPos.lng, p.latitude, p.longitude);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  })();
  const nearPortId = nearPort?.portId ?? null;
  const nearQueue = usePortQueue(nearPortId);

  // How far the nearest *queued* boat is from the passenger — re-read
  // whenever the queue itself changes (boats join / drop out).
  const [nearestBoatDistance, setNearestBoatDistance] = useState<number | null>(null);
  useEffect(() => {
    setNearestBoatDistance(null);
    if (!nearPortId || !myPos) return;
    const portId = nearPortId;
    const { lat, lng } = myPos;
    let alive = true;
    getNearestQueuedBoatDistance(portId, lat, lng)
      .then((d) => {
        if (alive) setNearestBoatDistance(d);
      })
      .catch(() => {
        // distance is a nice-to-have; the count still shows
      });
    return () => {
      alive = false;
    };
  }, [nearPortId, myPos, nearQueue.data.length]);

  // A landed parcel no longer warrants a live banner (and a batched stub can
  // still read 'open' until the batch resolves). The banner only sees booking
  // rows, so look up the sender's cargo parcels and drop the finished ones.
  const [deliveredBookingIds, setDeliveredBookingIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    const cargoIds = bookings.data
      .filter((b) => b.serviceType === 'cargo')
      .map((b) => b.bookingId);
    if (cargoIds.length === 0) return;
    let alive = true;
    (async () => {
      const { data, error } = await supabase
        .from('parcels')
        .select('booking_id, status')
        .in('booking_id', cargoIds)
        .in('status', ['delivered', 'returned']);
      if (!alive || error) return;
      setDeliveredBookingIds(
        new Set(
          (data ?? [])
            .map((r) => r.booking_id as string | null)
            .filter((id): id is string => Boolean(id)),
        ),
      );
    })();
    return () => {
      alive = false;
    };
  }, [bookings.data]);

  // Newest first. The banner must surface a live booking even when newer
  // finished trips would push it out of the top-3 recent list.
  const activeBookings = bookings.data.filter(
    (b) =>
      (b.status === 'open' || b.status === 'accepted' || b.status === 'pending') &&
      !deliveredBookingIds.has(b.bookingId)
  );
  const bannerBooking = activeBookings[0] ?? null;
  // Padala first: a batched sender's stub is cancelled at resolve, so the
  // parcel-derived banner is the only surface that can show the live batch.
  const activeDelivery = deliveries.data[0] ?? null;
  const bannerHeight = activeDelivery ? 84 : ACTIVE_BANNER_H;
  const openDelivery = () => {
    if (!activeDelivery) return;
    const parcel = activeDelivery.parcel;
    // Only a parcel still in the batching queue belongs on the waiting
    // screen; auto-soloed/in-transit former batches track via the booking.
    const waitingOnBatch =
      parcel.deliveryType === 'batched' &&
      (parcel.batchingStatus === 'pending_batch' || parcel.batchingStatus === 'batched');
    if (waitingOnBatch) {
      router.push({
        pathname: '/(passenger)/batched-waiting',
        params: { parcelId: parcel.parcelId },
      });
    } else {
      router.push(`/(passenger)/booking/${parcel.bookingId}`);
    }
  };
  const recentTrips = bookings.data
    .filter((b) => !deliveredBookingIds.has(b.bookingId))
    .slice(0, 3);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedPort, setSelectedPort] = useState<PortDoc | null>(null);

  /**
   * "Your trip was accepted!" pops once per accept, and never for bookings
   * that were already accepted when this screen loaded — the first data pass
   * seeds them as known, so only accepts observed live interrupt.
   */
  const [acceptedNotice, setAcceptedNotice] = useState<BookingDoc | null>(null);
  const dismissedRef = useRef<Set<string>>(new Set());
  const seededRef = useRef(false);

  useEffect(() => {
    if (bookings.loading) return;
    if (!seededRef.current) {
      seededRef.current = true;
      bookings.data.forEach((b) => {
        if (b.status === 'accepted' && !b.onboardedAt) dismissedRef.current.add(b.bookingId);
      });
      return;
    }
    const fresh = bookings.data.find(
      (b) => b.status === 'accepted' && !b.onboardedAt && !dismissedRef.current.has(b.bookingId)
    );
    if (!fresh) return;
    dismissedRef.current.add(fresh.bookingId);
    setAcceptedNotice(fresh);
    scheduleLocalNotification(
      'Your trip was accepted',
      `${fresh.operatorName ?? 'A bangkero'} accepted ${fresh.ref}. Head to ${fresh.fromPortName}.`
    ).catch(() => {});
  }, [bookings.loading, bookings.data]);

  // Starts collapsed so the map reads as the main surface on first open.
  const translateY = useSharedValue(DRAG_RANGE);
  const dragStart = useSharedValue(DRAG_RANGE);
  const dragProgress = useSharedValue(0);

  const snapTo = (expanded: boolean) => {
    'worklet';
    translateY.value = withSpring(expanded ? 0 : DRAG_RANGE, {
      damping: 28, stiffness: 300, overshootClamping: true,
    });
  };

  /**
   * The gesture lives on the handle only, not the whole sheet. Attaching it to
   * the sheet would fight the ScrollView inside it for the same vertical drag.
   */
  const pan = Gesture.Pan()
    .onStart(() => {
      dragStart.value = translateY.value;
      dragProgress.value = withTiming(1, { duration: 120 });
    })
    .onUpdate((e) => {
      translateY.value = Math.min(Math.max(dragStart.value + e.translationY, 0), DRAG_RANGE);
    })
    .onEnd((e) => {
      // A decisive flick wins over position; otherwise snap to the nearer point.
      const expand = e.velocityY < -400
        || (e.velocityY < 400 && translateY.value < DRAG_RANGE / 2);
      snapTo(expand);
      dragProgress.value = withTiming(0, { duration: 180 });
    });

  const tap = Gesture.Tap().onEnd(() => {
    snapTo(translateY.value > DRAG_RANGE / 2);
  });

  const handleGesture = Gesture.Exclusive(pan, tap);

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  // Callout rides above the sheet as it moves, so it never slides underneath.
  const calloutStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -(DRAG_RANGE - translateY.value) }],
  }));

  // Handle lights up and widens while held, confirming the drag registered.
  const grabberStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      dragProgress.value, [0, 1], [colors.textMuted, colors.primary]
    ),
    transform: [{ scaleX: 1 + dragProgress.value * 0.18 }],
  }));

  const greetingTime = (() => {
    const h = new Date().getHours();
    if (h < 12) return 'Magandang umaga';
    if (h < 17) return 'Magandang hapon';
    return 'Magandang gabi';
  })();

  const showQueue = !!nearPort && !nearQueue.loading;

  return (
    <View style={styles.root}>
      {/* Map is the page, not a card on it. Everything else floats above. */}
      {ports.error ? (
        <View style={styles.mapFallback}>
          <Text style={styles.mapFallbackText}>Map unavailable</Text>
        </View>
      ) : (
        <MapContainer
          ports={ports.data}
          fill
          onPortPress={(p) => setSelectedPort((cur) => (cur?.portId === p.portId ? null : p))}
          selectedPortId={selectedPort?.portId ?? null}
        />
      )}

      <SideDrawer
        visible={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={MENU_TITLE.passenger}
        // Already on home — a Home row here does nothing but close the drawer.
        items={menuFor('passenger').filter((i) => i.label !== 'Home')}
      />

      {/* ---------- floating header ---------- */}
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <View style={styles.greetCard}>
          <Text style={styles.greeting} numberOfLines={1}>{greetingTime}</Text>
          <Text style={styles.name} numberOfLines={1}>
            {profile?.firstName ?? 'Traveler'}
          </Text>
        </View>

        <View style={styles.headerRight}>
          <Pressable
            onPress={() => router.push('/(passenger)/notifications')}
            accessibilityRole="button"
            accessibilityLabel={
              notifications.unreadCount > 0
                ? `Notifications, ${notifications.unreadCount} unread`
                : 'Notifications'
            }
            style={({ pressed }) => [styles.iconBtn, pressed && styles.iconBtnPressed]}
          >
            <Icon name="bell" size={20} color={colors.text} />
            {notifications.unreadCount > 0 && (
              <View style={styles.notifBadge}>
                <Text style={styles.notifBadgeText}>
                  {notifications.unreadCount > 9 ? '9+' : notifications.unreadCount}
                </Text>
              </View>
            )}
          </Pressable>
          <View {...tMenu}>
            <Pressable
              onPress={() => setDrawerOpen(true)}
              accessibilityRole="button"
              accessibilityLabel="Open menu"
              style={({ pressed }) => [styles.iconBtn, pressed && styles.iconBtnPressed]}
            >
              <Icon name="menu" size={22} color={colors.text} />
            </Pressable>
          </View>
        </View>
      </View>

      {/* ---------- live status bar ----------
          Boats online and the nearest port's waiting line used to be two
          separate pills stacked down the left edge, which read as two
          unrelated alerts and ate 36pt more of the map than they needed to.
          They are one fact — "what's available near me" — so they share one
          bar, split by a rule. The queue segment only exists with a GPS fix. */}
      <View {...tStatus} style={[styles.statusBar, { top: insets.top + 76 }]}>
        <View style={styles.statusSeg}>
          <View style={[styles.dot, bangkeros.data === 0 && styles.dotOff]} />
          <Text style={styles.statusText} numberOfLines={1}>
            {bangkeros.loading
              ? 'Checking…'
              : bangkeros.data === 0
                ? 'No boats online'
                : `${bangkeros.data} boat${bangkeros.data === 1 ? '' : 's'} nearby`}
          </Text>
        </View>

        {showQueue && (
          <>
            <View style={styles.statusRule} />
            <View style={styles.statusSeg}>
              <View style={[styles.dot, nearQueue.data.length === 0 && styles.dotOff]} />
              <Text style={styles.statusText} numberOfLines={1}>
                {nearQueue.data.length === 0
                  ? `None waiting at ${nearPort!.portName}`
                  : `${nearQueue.data.length} waiting at ${nearPort!.portName}${
                      nearestBoatDistance != null ? ` · ${formatDistance(nearestBoatDistance)}` : ''
                    }`}
              </Text>
            </View>
          </>
        )}
      </View>

      {/* ---------- active booking / Padala banner ----------
          Sits just above the collapsed sheet and rides the same translateY as
          the port callout, so expanding the sheet slides it underneath —
          where RECENT TRIPS is already showing the same bookings. Padala wins
          while one is live; the booking still lists under RECENT TRIPS. */}
      {(activeDelivery || bannerBooking) && (
        <Animated.View style={[styles.bannerWrap, { height: bannerHeight }, calloutStyle]}>
          {activeDelivery ? (
            <Pressable
              onPress={openDelivery}
              accessibilityRole="button"
              accessibilityLabel={`Open Padala for ${activeDelivery.parcel.receiverName}`}
              style={({ pressed }) => [styles.banner, pressed && styles.bannerPressed]}
            >
              <View style={styles.bannerDot} />
              <View style={styles.bannerBody}>
                <Text style={styles.bannerRoute} numberOfLines={1}>
                  {deliveryNeedsAttention(activeDelivery.parcel)
                    ? 'Padala needs attention'
                    : 'Padala in progress'}
                </Text>
                <Text style={styles.bannerMeta} numberOfLines={1}>
                  {activeDelivery.booking
                    ? `${activeDelivery.booking.fromPortName} → ${activeDelivery.booking.toPortName}${
                        activeDelivery.booking.ref ? ` · ${activeDelivery.booking.ref}` : ''
                      }`
                    : `For ${activeDelivery.parcel.receiverName}`}
                </Text>
                <Text style={styles.bannerMeta} numberOfLines={1}>
                  {deliveryModeLabel(activeDelivery.parcel)} · {deliveryStateLabel(activeDelivery.parcel)}
                  {` · ${activeDelivery.parcel.receiverName} · ₱${activeDelivery.parcel.totalPrice}`}
                  {deliveries.data.length > 1 ? ` · +${deliveries.data.length - 1} more` : ''}
                </Text>
              </View>
              <Icon name="forward" size={18} color={colors.primary} />
            </Pressable>
          ) : bannerBooking ? (
            <Pressable
              onPress={() => router.push(`/(passenger)/booking/${bannerBooking.bookingId}`)}
              accessibilityRole="button"
              accessibilityLabel={`Open booking for ${bannerBooking.fromPortName} to ${bannerBooking.toPortName}`}
              style={({ pressed }) => [styles.banner, pressed && styles.bannerPressed]}
            >
              <View style={styles.bannerDot} />
              <View style={styles.bannerBody}>
                <Text style={styles.bannerRoute} numberOfLines={1}>
                  {bannerBooking.fromPortName} → {bannerBooking.toPortName}
                </Text>
                <Text style={styles.bannerMeta} numberOfLines={1}>
                  {bannerBooking.status === 'pending'
                    ? 'Awaiting confirmation'
                    : bannerBooking.status === 'open'
                      ? 'Waiting for a bangkero'
                      : 'Accepted'}
                  {' · '}{bannerBooking.numOfPassenger} pax · ₱{bannerBooking.totalPrice}
                  {activeBookings.length > 1 ? ` · +${activeBookings.length - 1} more` : ''}
                </Text>
              </View>
              <Icon name="forward" size={18} color={colors.primary} />
            </Pressable>
          ) : null}
        </Animated.View>
      )}

      {/* ---------- tapped-port callout ---------- */}
      {selectedPort && (
        <Animated.View
          style={[
            styles.callout,
            // Stack above the banner when both are on screen.
            (activeDelivery || bannerBooking) && {
              bottom: SHEET_COLLAPSED + spacing.md + bannerHeight + spacing.md,
            },
            calloutStyle,
          ]}
        >
          <View style={styles.calloutBody}>
            <Text style={styles.calloutLabel}>PORT</Text>
            <Text style={styles.calloutName} numberOfLines={1}>{selectedPort.portName}</Text>
            {!!selectedPort.location && (
              <Text style={styles.calloutMeta} numberOfLines={1}>{selectedPort.location}</Text>
            )}
          </View>
          <Pressable
            onPress={() => router.push('/(passenger)/quick-ride')}
            style={({ pressed }) => [styles.calloutBtn, pressed && styles.calloutBtnPressed]}
          >
            <Text style={styles.calloutBtnText}>Book</Text>
          </Pressable>
        </Animated.View>
      )}

      {/* ---------- bottom sheet ---------- */}
      <Animated.View style={[styles.sheet, sheetStyle]}>
        <GestureDetector gesture={handleGesture}>
          {/* Padded well beyond the 4pt bar so the drag target is finger-sized. */}
          <View {...tSheet} style={styles.handleZone}>
            <Animated.View style={[styles.grabber, grabberStyle]} />
          </View>
        </GestureDetector>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            styles.sheetScroll,
            { paddingBottom: insets.bottom + spacing.xl },
          ]}
        >
          {/* Primary action leads the sheet. It used to sit below the tile row,
              so the one thing 90% of passengers open this app to do was the
              second thing they saw. */}
          <View {...tCta}>
          <Pressable
            onPress={() => router.push('/(passenger)/quick-ride')}
            accessibilityRole="button"
            accessibilityLabel="Book a ride"
            style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
          >
            <View style={styles.ctaIconWrap}>
              <Icon name="ride" size={20} color={colors.primaryText} />
            </View>
            <View style={styles.ctaTextWrap}>
              <Text style={styles.ctaTitle}>Book a ride</Text>
              <Text style={styles.ctaSub} numberOfLines={1}>Find available boats near you</Text>
            </View>
            <Icon name="forward" size={20} color={colors.primaryText} />
          </Pressable>
          </View>

          <View {...tTiles}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.tiles}
          >
            {SERVICES.map((s) => (
              <Pressable
                key={s.key}
                disabled={!s.enabled}
                onPress={() => router.push(s.route as any)}
                style={({ pressed }) => [
                  styles.tile,
                  !s.enabled && styles.tileDisabled,
                  pressed && s.enabled && styles.tilePressed,
                ]}
              >
                <Icon
                  name={s.icon}
                  size={20}
                  color={s.enabled ? colors.primary : colors.textMuted}
                  style={styles.tileIcon}
                />
                <Text
                  style={[styles.tileLabel, !s.enabled && styles.tileLabelDisabled]}
                  numberOfLines={1}
                >
                  {s.label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
          </View>

          <View style={styles.weatherWrap}>
            <WeatherCard latitude={STRAIT_POINT.lat} longitude={STRAIT_POINT.lon} variant="bar" />
          </View>

          <View style={styles.sectionHead}>
            <Text style={styles.sectionLabel}>RECENT TRIPS</Text>
            {bookings.data.length > 0 && (
              <Pressable onPress={() => router.push('/(passenger)/bookings')} hitSlop={12}>
                <Text style={styles.sectionAction}>See all</Text>
              </Pressable>
            )}
          </View>

          {bookings.loading ? (
            <View style={styles.stateBox}><LoadingState label="Loading your trips…" /></View>
          ) : recentTrips.length === 0 ? (
            <View style={styles.stateBox}>
              <EmptyState
                icon="anchor"
                title="No trips yet"
                message="Your bookings will appear here."
              />
            </View>
          ) : (
            <View style={styles.tripList}>
              {recentTrips.map((b) => (
                <Pressable
                  key={b.bookingId}
                  onPress={() => router.push(`/(passenger)/booking/${b.bookingId}`)}
                  style={({ pressed }) => [styles.trip, pressed && styles.tripPressed]}
                >
                  <View style={styles.tripTop}>
                    <Text style={styles.tripRoute} numberOfLines={1}>
                      {b.fromPortName} → {b.toPortName}
                    </Text>
                    <Text style={styles.tripFare}>₱{b.totalPrice}</Text>
                  </View>
                  <Text style={styles.tripDate} numberOfLines={1}>
                    {new Date(b.createdAt).toLocaleDateString('en-PH', {
                      month: 'short', day: 'numeric',
                    })}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
        </ScrollView>
      </Animated.View>

      {/* ---------- accepted-trip notice ---------- */}
      <Modal
        visible={!!acceptedNotice}
        transparent
        animationType="fade"
        onRequestClose={() => setAcceptedNotice(null)}
      >
        <View style={styles.noticeBackdrop}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setAcceptedNotice(null)}
            accessibilityLabel="Close"
          />
          <View style={styles.noticeCard}>
            <View style={styles.noticeIconRing}>
              <Icon name="check" size={24} color={colors.primary} />
            </View>
            <Text style={styles.noticeTitle}>Your trip was accepted</Text>
            <Text style={styles.noticeBody}>
              {acceptedNotice?.operatorName ?? 'A bangkero'} accepted booking{' '}
              {acceptedNotice?.ref}. Meet at {acceptedNotice?.fromPortName} — the boat
              is waiting for you.
            </Text>
            <View style={styles.noticeActions}>
              <View style={styles.noticeActionBtn}>
                <PrimaryButton
                  label="Later"
                  variant="secondary"
                  onPress={() => setAcceptedNotice(null)}
                />
              </View>
              <View style={styles.noticeActionBtn}>
                <PrimaryButton
                  label="View trip"
                  onPress={() => {
                    const target = acceptedNotice;
                    setAcceptedNotice(null);
                    if (target) router.push(`/(passenger)/booking/${target.bookingId}`);
                  }}
                />
              </View>
            </View>
          </View>
        </View>
      </Modal>

      {/* First run only, keyed off the signed-in uid so a shared demo phone
          gives each account its own. Mounted last so the dimmers sit above
          the sheet and the map. */}
      <CoachOverlay
        visible={tour.show}
        steps={PASSENGER_COACH}
        rects={coachRects}
        onDone={tour.dismiss}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },

  mapFallback: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.bgElevated,
    alignItems: 'center', justifyContent: 'center',
  },
  mapFallbackText: { ...typography.caption, color: colors.textMuted },

  // ---------- header ----------
  header: {
    position: 'absolute', left: 0, right: 0, top: 0,
    flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  // Text over a map needs its own ground or it becomes unreadable the moment
  // a coastline passes behind it.
  greetCard: {
    backgroundColor: colors.scrim,
    borderRadius: radii.lg,
    borderWidth: 1, borderColor: colors.borderSubtle,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    flexShrink: 1,
    ...elevation.e1,
  },
  // The greeting is the overline and the name is the headline — the two were
  // 11pt and 16pt before, close enough that neither led.
  greeting: { flexShrink: 1, ...typography.label },
  name: { flexShrink: 1, ...typography.title },

  headerRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  iconBtn: {
    position: 'relative',
    width: touchTarget, height: touchTarget,
    alignItems: 'center', justifyContent: 'center',
    borderRadius: radii.pill,
    backgroundColor: colors.scrim,
    borderWidth: 1, borderColor: colors.borderSubtle,
    ...elevation.e1,
  },
  iconBtnPressed: { backgroundColor: colors.surfaceAlt },
  notifBadge: {
    position: 'absolute', top: 1, right: 1,
    backgroundColor: colors.danger, borderRadius: radii.pill,
    minWidth: 18, height: 18, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: spacing.xs,
    borderWidth: 2, borderColor: colors.bg,
  },
  notifBadgeText: { flexShrink: 1, ...typography.micro, ...numeric, lineHeight: 14 },

  // ---------- live status bar ----------
  statusBar: {
    position: 'absolute', left: spacing.lg, right: spacing.lg,
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.scrim, borderRadius: radii.pill,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm - 1,
    borderWidth: 1, borderColor: colors.borderSubtle,
    ...elevation.e1,
  },
  statusSeg: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    flexShrink: 1,
  },
  // A hairline rule, not a dot or a bullet: it separates two readings without
  // adding a third thing that looks like a status indicator.
  statusRule: {
    width: 1, alignSelf: 'stretch',
    marginHorizontal: spacing.md,
    backgroundColor: colors.border,
  },
  dot: { width: 7, height: 7, borderRadius: radii.pill, backgroundColor: colors.primary },
  dotOff: { backgroundColor: colors.textMuted },
  statusText: { flexShrink: 1, ...typography.caption, color: colors.text, fontWeight: '600' },

  // ---------- active booking banner ----------
  bannerWrap: {
    position: 'absolute', left: spacing.lg, right: spacing.lg,
    bottom: SHEET_COLLAPSED + spacing.md,
    height: ACTIVE_BANNER_H,
  },
  banner: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surface, borderRadius: radii.lg,
    borderWidth: 1, borderColor: colors.primary,
    paddingHorizontal: spacing.lg,
    ...elevation.e3,
  },
  bannerPressed: { backgroundColor: colors.surfaceAlt },
  bannerDot: { width: 8, height: 8, borderRadius: radii.pill, backgroundColor: colors.primary },
  bannerBody: { flex: 1, minWidth: 0 },
  bannerRoute: { flexShrink: 1, ...typography.bodyStrong, lineHeight: 20 },
  bannerMeta: {
    flexShrink: 1, ...typography.label, ...numeric,
    color: colors.textMuted, fontWeight: '400', letterSpacing: 0,
  },

  // ---------- port callout ----------
  callout: {
    position: 'absolute', left: spacing.lg, right: spacing.lg,
    bottom: SHEET_COLLAPSED + spacing.md,
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.lg,
    borderWidth: 1, borderColor: colors.primary,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    ...elevation.e3,
  },
  calloutBody: { flex: 1 },
  calloutLabel: { ...typography.label, color: colors.primary },
  calloutName: { flexShrink: 1, ...typography.bodyStrong, marginTop: spacing.xxs },
  calloutMeta: { flexShrink: 1, ...typography.caption, color: colors.textMuted },
  calloutBtn: {
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
    height: 36, minWidth: 72,
    alignItems: 'center', justifyContent: 'center',
  },
  calloutBtnPressed: { backgroundColor: colors.primaryDark },
  calloutBtnText: { ...typography.caption, color: colors.primaryText, fontWeight: '800' },

  // ---------- bottom sheet ----------
  sheet: {
    position: 'absolute', left: 0, right: 0,
    // Anchored flush to the bottom. translateY then slides it DOWN by at most
    // DRAG_RANGE, so the visible height is never less than SHEET_COLLAPSED.
    // (A negative `bottom` here would double-count the offset and bury the sheet.)
    bottom: 0,
    height: SHEET_EXPANDED,
    backgroundColor: colors.bg,
    borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl,
    borderTopWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    ...elevation.e3,
  },
  handleZone: {
    alignItems: 'center',
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    marginHorizontal: -spacing.lg, // full-width drag strip
  },
  // `colors.border` here was invisible: #24404D on a #0A1620 ground is barely a
  // shade apart. A grab handle has to advertise itself, so it uses a text-level
  // colour rather than a border-level one.
  grabber: {
    width: 48, height: 5, borderRadius: radii.pill,
    backgroundColor: colors.textMuted,
  },
  sheetScroll: {},

  // ---------- CTA ----------
  cta: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.primary, borderRadius: radii.lg,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    minHeight: 60,
    ...elevation.e2,
  },
  ctaPressed: { backgroundColor: colors.primaryDark },
  ctaIconWrap: {
    width: 36, height: 36, borderRadius: radii.pill,
    backgroundColor: colors.onPrimaryWash,
    alignItems: 'center', justifyContent: 'center',
  },
  ctaTextWrap: { flex: 1, minWidth: 0 },
  // Sentence case, not SHOUTING. All-caps was doing the job 20pt now does.
  ctaTitle: { ...typography.title, color: colors.primaryText, lineHeight: 24 },
  ctaSub: {
    flexShrink: 1, ...typography.label,
    color: colors.primaryText, opacity: 0.75,
    fontWeight: '400', letterSpacing: 0,
  },

  // ---------- secondary service tiles ----------
  // Three tiles no longer fill the width, so left-aligning them left a gap on
  // the right that read as a missing fourth tile. `flexGrow` makes the content
  // container at least as wide as the viewport so `justifyContent` has room to
  // centre — and the ScrollView still scrolls on a narrow phone where the row
  // genuinely overflows.
  tiles: {
    flexDirection: 'row', gap: spacing.sm,
    paddingTop: spacing.md, paddingBottom: spacing.xxs,
    flexGrow: 1, justifyContent: 'center',
  },
  tile: {
    width: 92,
    backgroundColor: colors.surface, borderRadius: radii.md,
    borderWidth: 1, borderColor: colors.borderSubtle,
    paddingVertical: spacing.md, paddingHorizontal: spacing.xs,
    alignItems: 'center', justifyContent: 'center',
    ...elevation.e1,
  },
  tileDisabled: { opacity: 0.4, shadowOpacity: 0, elevation: 0 },
  tilePressed: { borderColor: colors.primary, backgroundColor: colors.surfaceAlt },
  tileIcon: { marginBottom: spacing.xs },
  tileLabel: { ...typography.label, color: colors.text, letterSpacing: 0 },
  tileLabelDisabled: { color: colors.textMuted },

  // ---------- recent trips ----------
  sectionHead: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: spacing.xl, marginBottom: spacing.sm,
  },
  sectionLabel: { ...typography.label },
  sectionAction: { ...typography.caption, color: colors.primary, fontWeight: '600' },
  weatherWrap: { marginTop: spacing.lg },

  stateBox: { minHeight: 140 },

  tripList: { gap: spacing.sm },
  trip: {
    backgroundColor: colors.surface, borderRadius: radii.md,
    borderWidth: 1, borderColor: colors.borderSubtle,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    ...elevation.e1,
  },
  tripPressed: { borderColor: colors.primary, backgroundColor: colors.surfaceAlt },
  tripTop: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: spacing.md },
  // The route is the content of this card, so it gets body weight — it was
  // 13pt caption, the same size as its own timestamp.
  tripRoute: { ...typography.bodyStrong, lineHeight: 20, flex: 1 },
  tripFare: { flexShrink: 1, ...typography.bodyStrong, ...numeric, color: colors.primary, lineHeight: 20 },
  tripDate: { flexShrink: 1, ...typography.label, fontWeight: '400', letterSpacing: 0 },

  // ---------- accepted-trip notice ----------
  noticeBackdrop: {
    flex: 1,
    backgroundColor: colors.backdrop,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  noticeCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.primary,
    padding: spacing.xl,
    alignItems: 'center',
    ...elevation.e3,
  },
  noticeIconRing: {
    width: 52,
    height: 52,
    borderRadius: radii.pill,
    backgroundColor: colors.primaryTint,
    borderWidth: 1,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  noticeTitle: { ...typography.title, textAlign: 'center', marginBottom: spacing.xs },
  noticeBody: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
  noticeActions: { flexDirection: 'row', gap: spacing.md, alignSelf: 'stretch' },

  noticeActionBtn: { flex: 1 },
});
