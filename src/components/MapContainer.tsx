import React, { useState } from 'react';
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
}

/**
 * Map wrapper that tries OSMMap (WebView + Leaflet) first.
 * Falls back to SeaMap (static SVG) if WebView fails.
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
      />
    </View>
  );
}
