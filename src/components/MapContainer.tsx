import { useState } from 'react';
import { View } from 'react-native';

import { OSMMap } from './OSMMap';
import { SeaMap } from './SeaMap';
import type { PortDoc } from '../types/models';

interface Props {
  ports: PortDoc[];
  fromPortId?: string | null;
  toPortId?: string | null;
  height?: number;
  fill?: boolean;
  onPortPress?: (port: PortDoc) => void;
  selectedPortId?: string | null;
  vessels?: { latitude: number; longitude: number; speed?: number | null; bangkaId?: string }[];
  /** Pass false for a map inside a ScrollView that must keep scrolling. */
  draggable?: boolean;
  /** Lift the zoom controls clear of an overlapping sheet. */
  controlsOffset?: number;
  showControls?: boolean;
}

/**
 * Map wrapper that tries OSMMap (WebView + Leaflet) first and falls back to
 * SeaMap (static SVG) when the tiles or Leaflet itself can't be reached.
 *
 * That fallback used to be unreachable: `setOsmFailed` was never called and
 * OSMMap swallowed its own `onError`, so a blocked CDN left a grey rectangle
 * on screen with nothing to recover it. On venue wifi — the single most likely
 * thing to go wrong during the demo — that is the difference between a
 * degraded map and a broken one.
 */
export function MapContainer({
  ports,
  fromPortId = null,
  toPortId = null,
  height = 200,
  fill = false,
  onPortPress,
  selectedPortId = null,
  vessels = [],
  draggable = true,
  controlsOffset = 0,
  showControls = true,
}: Props) {
  const [osmFailed, setOsmFailed] = useState(false);

  if (osmFailed) {
    return (
      <SeaMap
        ports={ports}
        fromPortId={fromPortId}
        toPortId={toPortId}
        height={height}
        fill={fill}
        onPortPress={onPortPress}
        selectedPortId={selectedPortId}
      />
    );
  }

  return (
    <View style={fill ? { flex: 1 } : undefined}>
      <OSMMap
        ports={ports}
        fromPortId={fromPortId}
        toPortId={toPortId}
        height={height}
        fill={fill}
        onPortPress={onPortPress}
        selectedPortId={selectedPortId}
        vessels={vessels}
        draggable={draggable}
        controlsOffset={controlsOffset}
        showControls={showControls}
        onFail={() => setOsmFailed(true)}
      />
    </View>
  );
}
