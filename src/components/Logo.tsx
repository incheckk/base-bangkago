import Svg, { Circle, G, Path, Rect } from 'react-native-svg';

import { colors } from '@/theme/tokens';

export type LogoVariant = 'mark' | 'tile' | 'seal';

// The approved boat from brand-preview.html — coordinates are shared with
// web/assets/img/brand/*.svg, so a redraw has to happen in both places.
function Boat() {
  return (
    <>
      <G stroke={colors.primary} strokeWidth={34} strokeLinecap="round">
        <Path d="M317 468 L271 578" />
        <Path d="M612 468 L567 578" />
      </G>
      <Path
        d="M533 284 L679.3 120.4 Q694 104 716 104 L845 104 Q858 104 858 117 L858 284 Z"
        fill={colors.primary}
      />
      <Path
        d="M104.7 275.4 Q90 254 116 254 L927 254 Q953 254 936.4 274 L781.6 460 Q765 480 739 480 L271 480 Q245 480 230.3 458.6 Z"
        fill={colors.hull}
      />
      <Rect x={136} y={578} width={542} height={66} rx={33} fill={colors.sun} />
    </>
  );
}

/**
 * mark — boat on transparency for light surfaces (documents, Android adaptive
 *        foreground). Never on the app's dark background: the hull disappears.
 * tile — cream squircle, matches the app icon.
 * seal — cream disc with a teal ring, for the welcome screen and web portal.
 */
export function Logo({ variant = 'mark', size = 96 }: { variant?: LogoVariant; size?: number }) {
  if (variant === 'seal') {
    return (
      <Svg width={size} height={size} viewBox="0 0 620 620">
        <Circle cx={310} cy={310} r={310} fill={colors.cream} />
        <Circle cx={310} cy={310} r={288} fill="none" stroke={colors.primary} strokeWidth={12} />
        <G transform="translate(12.745 96.82) scale(0.57)">
          <Boat />
        </G>
      </Svg>
    );
  }

  if (variant === 'tile') {
    return (
      <Svg width={size} height={size} viewBox="0 0 1012 1012">
        <Rect width={1012} height={1012} rx={227} fill={colors.cream} />
        <G transform="translate(81 212) scale(0.84)">
          <Boat />
        </G>
      </Svg>
    );
  }

  return (
    <Svg width={size} height={(size * 700) / 1012} viewBox="0 0 1012 700">
      <Boat />
    </Svg>
  );
}
