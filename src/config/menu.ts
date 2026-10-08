import { router } from 'expo-router';

import type { IconName } from '@/components/Icon';
import { signOut } from '@/services/auth.service';
import type { UserRole } from '@/types/models';

export interface MenuItem {
  icon: IconName;
  label: string;
  onPress: () => void;
  danger?: boolean;
}

/**
 * One definition of the side menu for every role.
 *
 * These used to be written inline on each home screen, which is how passenger,
 * bangkero and admin ended up with four different menus — different item sets,
 * inconsistent "Sign out" vs "Sign Out", and a passenger menu with no way to
 * sign out at all.
 *
 * Every role follows the same shape: Home, the role's own destinations, then
 * Profile and Sign out as the last two entries. Only the middle varies.
 *
 * Sidebar uses router.replace() to avoid stacking duplicate screens —
 * tapping Home replaces the current screen instead of pushing another on top.
 */
const ROLE_ITEMS: Record<UserRole | 'admin', MenuItem[]> = {
  passenger: [
    { icon: 'home', label: 'Home', onPress: () => router.replace('/(passenger)/home') },
    { icon: 'bookings', label: 'My Bookings', onPress: () => router.replace('/(passenger)/bookings') },
    { icon: 'rental', label: 'My Rentals', onPress: () => router.replace('/(passenger)/my-rentals') },
  ],
  bangkero: [
    { icon: 'home', label: 'Home', onPress: () => router.replace('/(bangkero)/home') },
    { icon: 'history', label: 'My Trips', onPress: () => router.replace('/(bangkero)/trips') },
    { icon: 'rental', label: 'Boat Rentals', onPress: () => router.replace('/(bangkero)/rentals') },
    { icon: 'star', label: 'My Ratings', onPress: () => router.replace('/(bangkero)/ratings') },
    { icon: 'cash', label: 'Earnings', onPress: () => router.replace('/(bangkero)/earnings') },
    { icon: 'weather', label: 'Weather', onPress: () => router.replace('/(bangkero)/weather') },
    { icon: 'sos', label: 'SOS Alert', onPress: () => router.replace('/(bangkero)/sos-alert'), danger: true },
  ],
  admin: [
    { icon: 'home', label: 'Home', onPress: () => router.replace('/(admin)/home') },
    { icon: 'people', label: 'Manage Operators', onPress: () => router.replace('/(admin)/operators') },
    { icon: 'profile', label: 'All Users', onPress: () => router.replace('/(admin)/all-users') },
    { icon: 'boat', label: 'Active Trips', onPress: () => router.replace('/(admin)/active-trips') },
    { icon: 'anchor', label: 'Fleet Overview', onPress: () => router.replace('/(admin)/fleet-overview') },
    { icon: 'port', label: 'Manage Ports', onPress: () => router.replace('/(admin)/manage-ports') },
    { icon: 'route', label: 'Manage Routes', onPress: () => router.replace('/(admin)/manage-routes') },
    { icon: 'receipt', label: 'Reports', onPress: () => router.replace('/(admin)/reports') },
    { icon: 'rental', label: 'Boat Rentals', onPress: () => router.replace('/(admin)/boat-rentals') },
    { icon: 'cash', label: 'Downpayments', onPress: () => router.replace('/(admin)/downpayments') },
    { icon: 'card', label: 'GCash QR', onPress: () => router.replace('/(admin)/gcash-qr') },
    { icon: 'alert', label: 'System Alerts', onPress: () => router.replace('/(admin)/system-alerts') },
    { icon: 'settings', label: 'Developer Options', onPress: () => router.replace('/(admin)/developer-options') },
  ],
  // B12 view-only tier: see queues and fares, change nothing.
  coastguard: [
    { icon: 'home', label: 'Home', onPress: () => router.replace('/(coastguard)/home') },
  ],
};

const PROFILE_ROUTE: Record<UserRole | 'admin', Parameters<typeof router.replace>[0]> = {
  passenger: '/(passenger)/profile',
  bangkero: '/(bangkero)/profile',
  admin: '/(admin)/profile',
  coastguard: '/(coastguard)/profile',
};

/**
 * Sign out never navigates. The root guard notices the session is gone and
 * routes to the auth stack on its own — pushing here would race it.
 */
/** Same pattern for every role, so the drawer header never reads differently. */
export const MENU_TITLE: Record<UserRole | 'admin', string> = {
  passenger: 'PASSENGER',
  bangkero: 'BANGKERO',
  admin: 'ADMIN',
  coastguard: 'COASTGUARD / LGU',
};

export function menuFor(role: UserRole | 'admin'): MenuItem[] {
  const items: MenuItem[] = [
    ...ROLE_ITEMS[role],
    { icon: 'logout', label: 'Sign out', onPress: () => { void signOut(); }, danger: true },
  ];

  // Bangkero has a profile icon on the home screen header — no need in sidebar.
  if (role !== 'bangkero') {
    items.splice(0, 0, { icon: 'profile', label: 'Profile', onPress: () => router.replace(PROFILE_ROUTE[role]) });
  }

  return items;
}
