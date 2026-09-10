import type { TextStyle, ViewStyle } from 'react-native';

export const colors = {
  bg: '#0A1620',
  bgElevated: '#101E28',
  surface: '#16262F',
  surfaceAlt: '#1B2F3A',
  border: '#24404D',
  borderSubtle: '#1D3441',

  primary: '#34D6B0',
  primaryDark: '#1FA88A',
  primaryText: '#04241D',

  accent: '#E8593C',
  warning: '#E8A93C',
  danger: '#E05252',
  // Separate from `primary` on purpose: a success tick and a brand button are
  // different ideas, and using one token for both makes them impossible to
  // retune independently.
  success: '#3CD97E',
  info: '#4BA8E8',

  text: '#F2F5F4',
  textSecondary: '#A9BEC4',
  textMuted: '#5F7883',
  textOnDisabled: '#4A6672',

  // Translucent fills for pills, banners and badges. These were previously
  // written as raw rgba() strings inline, which is how two different "warning
  // yellows" ended up shipping.
  primaryTint: 'rgba(52,214,176,0.12)',
  successTint: 'rgba(60,217,126,0.12)',
  warningTint: 'rgba(232,169,60,0.12)',
  // Softer fill and a visible border for full-width alert cards, where a 0.12
  // wash reads as a rendering artefact rather than a deliberate surface.
  warningTintSoft: 'rgba(232,169,60,0.08)',
  warningBorder: 'rgba(232,169,60,0.30)',
  dangerTint: 'rgba(224,82,82,0.12)',
  infoTint: 'rgba(75,168,232,0.12)',
  // Scrim for content floating over the map or a photo.
  scrim: 'rgba(10,22,32,0.85)',
} as const;

export const spacing = {
  xxs: 2,   // label/value pairs — was hardcoded in 47 places
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  huge: 48, // major section breaks
} as const;

export const radii = {
  xs: 4,
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,     // absorbs the ad-hoc 18 / 22 / 24
  avatar: 40,
  pill: 999,
} as const;

/**
 * Minimum comfortable tap size. Anything a finger lands on should reach this,
 * via height or hitSlop.
 */
export const touchTarget = 44;

export const typography = {
  display: { fontSize: 32, fontWeight: '800' as const, color: colors.text },
  h1: { fontSize: 28, fontWeight: '700' as const, color: colors.text },
  h2: { fontSize: 20, fontWeight: '700' as const, color: colors.text },
  title: { fontSize: 16, fontWeight: '600' as const, color: colors.text },
  body: { fontSize: 15, fontWeight: '400' as const, color: colors.text },
  bodyStrong: { fontSize: 15, fontWeight: '600' as const, color: colors.text },
  caption: { fontSize: 13, fontWeight: '400' as const, color: colors.textSecondary },
  label: { fontSize: 11, fontWeight: '600' as const, color: colors.textMuted, letterSpacing: 1 },
  micro: { fontSize: 11, fontWeight: '700' as const, color: colors.text },
} as const;

/**
 * Depth. On a near-black ground a shadow alone is nearly invisible, so each
 * level pairs a shadow with the surface colour it is meant to sit on —
 * `surface` for e1, `surfaceAlt` for e2 and above.
 */
export const elevation: Record<'e1' | 'e2' | 'e3', ViewStyle> = {
  e1: {
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  e2: {
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  e3: {
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
};

export type Typography = typeof typography;
export type TypographyToken = keyof Typography;
export const text = (t: TypographyToken): TextStyle => typography[t];
