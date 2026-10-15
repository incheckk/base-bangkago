import { router } from 'expo-router';

import type { IconName } from '@/components/Icon';
import { signOut } from '@/services/auth.service';
import type { UserRole } from '@/types/models';

export interface MenuItem {
  icon: IconName;
  label: string;
  onPress: () => void;
  danger?: boolean;
  /**
   * The destination, so the drawer can mark the row you are already on.
   * Absent for rows that do something other than navigate (Sign out).
   */
  route?: string;
  /** Grouping header shown above this row when it starts a new group. */
  section?: string;
  /** Held in a fixed footer instead of scrolling away with the rest. */
  pinned?: boolean;
}

type Entry = Omit<MenuItem, 'onPress'> & { route: string };

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
const ROLE_ITEMS: Record<UserRole | 'admin', Entry[]> = {
  passenger: [
    { icon: 'home', label: 'Home', route: '/(passenger)/home' },
    { icon: 'bookings', label: 'My Bookings', route: '/(passenger)/bookings' },
    { icon: 'rental', label: 'My Rentals', route: '/(passenger)/my-rentals' },
  ],
  bangkero: [
    { icon: 'home', label: 'Home', route: '/(bangkero)/home' },
    { icon: 'history', label: 'My Trips', route: '/(bangkero)/trips' },
    { icon: 'rental', label: 'Boat Rentals', route: '/(bangkero)/rentals' },
    { icon: 'star', label: 'My Ratings', route: '/(bangkero)/ratings' },
    { icon: 'cash', label: 'Earnings', route: '/(bangkero)/earnings' },
    { icon: 'weather', label: 'Weather', route: '/(bangkero)/weather' },
    { icon: 'sos', label: 'SOS Alert', route: '/(bangkero)/sos-alert', danger: true },
  ],
  /**
   * Grouped, because sixteen flat rows is a list you read rather than a menu
   * you scan. The headers also make it obvious which half of the console you
   * are in — operations, money, or the things that only break.
   */
  admin: [
    { icon: 'home', label: 'Home', route: '/(admin)/home', section: 'OPERATIONS' },
    { icon: 'people', label: 'Operators', route: '/(admin)/operators' },
    { icon: 'profile', label: 'All Users', route: '/(admin)/all-users' },
    { icon: 'boat', label: 'Active Trips', route: '/(admin)/active-trips' },

    { icon: 'anchor', label: 'Fleet Overview', route: '/(admin)/fleet-overview', section: 'FLEET' },
    { icon: 'port', label: 'Manage Ports', route: '/(admin)/manage-ports' },
    { icon: 'route', label: 'Manage Routes', route: '/(admin)/manage-routes' },
    { icon: 'rental', label: 'Boat Rentals', route: '/(admin)/boat-rentals' },

    { icon: 'cash', label: 'Downpayments', route: '/(admin)/downpayments', section: 'FINANCE' },
    { icon: 'card', label: 'GCash QR', route: '/(admin)/gcash-qr' },
    { icon: 'receipt', label: 'Reports', route: '/(admin)/reports' },

    // Named for the screens they open. Both this and the home screen's quick
    // action read "System Alerts" while pointing at two different screens —
    // /system-alerts is titled "Safety Alerts", /alerts is titled "System
    // Alerts" — so one of the two labels was always lying.
    { icon: 'sos', label: 'Safety Alerts', route: '/(admin)/system-alerts', section: 'SAFETY' },
    { icon: 'alert', label: 'System Alerts', route: '/(admin)/alerts' },

    { icon: 'settings', label: 'Developer Options', route: '/(admin)/developer-options', section: 'SYSTEM' },
  ],
  // B12 view-only tier: see queues and fares, change nothing.
  coastguard: [
    { icon: 'home', label: 'Home', route: '/(coastguard)/home' },
  ],
};

const PROFILE_ROUTE: Record<UserRole | 'admin', string> = {
  passenger: '/(passenger)/profile',
  bangkero: '/(bangkero)/profile',
  admin: '/(admin)/profile',
  coastguard: '/(coastguard)/profile',
};

/** Same pattern for every role, so the drawer header never reads differently. */
export const MENU_TITLE: Record<UserRole | 'admin', string> = {
  passenger: 'PASSENGER',
  bangkero: 'BANGKERO',
  admin: 'ADMIN',
  coastguard: 'COASTGUARD / LGU',
};

/**
 * `/(admin)/operators` → `/operators`.
 *
 * usePathname() reports the resolved path with the route group stripped, so a
 * raw comparison against the href never matches and no row would ever show as
 * current.
 */
export function normalizeRoute(route: string): string {
  return route.replace(/^\/\([^)]+\)/, '');
}

export function menuFor(role: UserRole | 'admin'): MenuItem[] {
  const items: MenuItem[] = ROLE_ITEMS[role].map((e) => ({
    ...e,
    onPress: () => router.replace(e.route as never),
  }));

  // Bangkero has a profile icon on the home screen header — no need in sidebar.
  if (role !== 'bangkero') {
    items.unshift({
      icon: 'profile',
      label: 'Profile',
      route: PROFILE_ROUTE[role],
      onPress: () => router.replace(PROFILE_ROUTE[role] as never),
    });
  }

  /**
   * Sign out never navigates. The root guard notices the session is gone and
   * routes to the auth stack on its own — pushing here would race it.
   *
   * Pinned: as the last row of an unscrollable list it sat below the fold on
   * the admin menu, so the one role with the most screens was the one role
   * that could not sign out.
   */
  items.push({
    icon: 'logout',
    label: 'Sign out',
    danger: true,
    pinned: true,
    onPress: () => { void signOut(); },
  });

  return items;
}
