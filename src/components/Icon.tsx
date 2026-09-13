import Ionicons from '@expo/vector-icons/Ionicons';
import React from 'react';

import { colors } from '../theme/tokens';

/**
 * One vector icon set, addressed by intent rather than by glyph name.
 *
 * Emoji were rendering as the app's iconography, which has three problems: they
 * are drawn by the OS so they differ per device and per OS version, they carry
 * their own colour so they can never match the palette, and they sit on a text
 * baseline so they never align cleanly with a label. Vector icons fix all three.
 *
 * Adding an icon: add a name here, not an inline <Ionicons> in a screen — that
 * is how a codebase ends up with four subtly different "boat" glyphs.
 */
export const ICONS = {
  // navigation / chrome
  home: 'home',
  menu: 'menu',
  back: 'chevron-back',
  forward: 'chevron-forward',
  close: 'close',
  bell: 'notifications',
  profile: 'person-circle',
  settings: 'settings',
  logout: 'log-out',

  // domain
  boat: 'boat',
  ride: 'navigate',
  island: 'sunny',
  parcel: 'cube',
  rental: 'browsers',
  port: 'location',
  route: 'git-branch',
  anchor: 'boat-outline',

  // money / records
  wallet: 'wallet',
  cash: 'cash',
  card: 'card',
  receipt: 'receipt',
  bookings: 'list',
  history: 'time',

  // status
  check: 'checkmark-circle',
  warning: 'warning',
  alert: 'alert-circle',
  info: 'information-circle',
  star: 'star',
  weather: 'partly-sunny',
  people: 'people',
  sos: 'megaphone',
} as const;

export type IconName = keyof typeof ICONS;

interface Props {
  name: IconName;
  size?: number;
  color?: string;
  style?: React.ComponentProps<typeof Ionicons>['style'];
}

export function Icon({ name, size = 20, color = colors.text, style }: Props) {
  return <Ionicons name={ICONS[name] as never} size={size} color={color} style={style} />;
}
