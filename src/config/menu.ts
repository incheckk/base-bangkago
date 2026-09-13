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
 */
const ROLE_ITEMS: Record<UserRole | 'admin', MenuItem[]> = {
  passenger: [
    { icon: 'home', label: 'Home', onPress: () => router.push('/(passenger)/home') },
    { icon: 'bookings', label: 'My Bookings', onPress: () => router.push('/(passenger)/bookings') },
    { icon: 'history', label: 'Trip History', onPress: () => router.push('/(passenger)/trips') },
    { icon: 'wallet', label: 'My Wallet', onPress: () => router.push('/(passenger)/wallet') },
    { icon: 'bell', label: 'Notifications', onPress: () => router.push('/(passenger)/notifications') },
  ],
  bangkero: [
    { icon: 'home', label: 'Home', onPress: () => router.push('/(bangkero)/home') },
    { icon: 'history', label: 'My Trips', onPress: () => router.push('/(bangkero)/trips') },
    { icon: 'cash', label: 'Earnings', onPress: () => router.push('/(bangkero)/earnings') },
    { icon: 'weather', label: 'Weather', onPress: () => router.push('/(bangkero)/weather') },
    { icon: 'sos', label: 'SOS Alert', onPress: () => router.push('/(bangkero)/sos-alert'), danger: true },
  ],
  admin: [
    { icon: 'home', label: 'Home', onPress: () => router.push('/(admin)/home') },
    { icon: 'people', label: 'Manage Operators', onPress: () => router.push('/(admin)/operators') },
    { icon: 'profile', label: 'All Users', onPress: () => router.push('/(admin)/all-users') },
    { icon: 'boat', label: 'Active Trips', onPress: () => router.push('/(admin)/active-trips') },
    { icon: 'route', label: 'Fleet Overview', onPress: () => router.push('/(admin)/fleet-overview') },
    { icon: 'alert', label: 'System Alerts', onPress: () => router.push('/(admin)/system-alerts') },
  ],
};

const PROFILE_ROUTE: Record<UserRole | 'admin', Parameters<typeof router.push>[0]> = {
  passenger: '/(passenger)/profile',
  bangkero: '/(bangkero)/profile',
  admin: '/(admin)/profile',
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
};

export function menuFor(role: UserRole | 'admin'): MenuItem[] {
  return [
    ...ROLE_ITEMS[role],
    { icon: 'profile', label: 'Profile', onPress: () => router.push(PROFILE_ROUTE[role]) },
    { icon: 'logout', label: 'Sign out', onPress: () => { void signOut(); }, danger: true },
  ];
}
