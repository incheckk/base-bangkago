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

  text: '#F2F5F4',
  textSecondary: '#A9BEC4',
  textMuted: '#5F7883',
  textOnDisabled: '#4A6672',
} as const;

export const spacing = {
  xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32,
} as const;

export const radii = {
  sm: 6, md: 10, lg: 14, pill: 999,
} as const;

export const typography = {
  h1: { fontSize: 28, fontWeight: '700' as const, color: colors.text },
  h2: { fontSize: 20, fontWeight: '700' as const, color: colors.text },
  body: { fontSize: 15, fontWeight: '400' as const, color: colors.text },
  label: { fontSize: 11, fontWeight: '600' as const, color: colors.textMuted, letterSpacing: 1 },
  caption: { fontSize: 13, fontWeight: '400' as const, color: colors.textSecondary },
} as const;