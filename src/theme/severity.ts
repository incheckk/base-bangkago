import { colors } from './tokens';

export type Severity = 'low' | 'medium' | 'high' | 'critical';

/**
 * One definition of what each severity looks like.
 *
 * This lived inline in `alerts.tsx`, `system-alerts.tsx` and `StatusCard.tsx`.
 * Two of the three agreed; the third rendered "high" in amber instead of
 * orange, so the same alert changed colour depending on which screen you
 * opened it from. Severity is a shared vocabulary — it cannot be per-file.
 */
export const SEVERITY: Record<
  Severity,
  { fg: string; bg: string; border: string; label: string }
> = {
  low: {
    fg: colors.textSecondary,
    bg: colors.neutralTint,
    border: colors.borderSubtle,
    label: 'Low',
  },
  medium: {
    fg: colors.warning,
    bg: colors.warningTintSoft,
    border: colors.warningBorder,
    label: 'Medium',
  },
  high: {
    fg: colors.accent,
    bg: colors.accentTintSoft,
    border: colors.accentBorder,
    label: 'High',
  },
  critical: {
    fg: colors.danger,
    bg: colors.dangerTintSoft,
    border: colors.dangerBorder,
    label: 'Critical',
  },
};
