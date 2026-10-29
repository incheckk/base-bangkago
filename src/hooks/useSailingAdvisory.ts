import { useCallback, useEffect, useState } from 'react';

import { useRealtimeQuery } from './useRealtimeQuery';
import { getSailingAdvisory, type SailingAdvisory } from '../services/advisory.service';

/**
 * The live sailing advisory for banners and gates. Null means "no advisory"
 * (including a database that has not run migration 069 yet).
 */
export function useSailingAdvisory() {
  const [data, setData] = useState<SailingAdvisory | null>(null);

  const load = useCallback(async () => {
    const row = await getSailingAdvisory().catch(() => null);
    setData(row);
  }, []);

  useEffect(() => { void load(); }, [load]);
  useRealtimeQuery(load, [{ table: 'sailing_advisory' }]);

  return { advisory: data, active: !!data?.active, refresh: load };
}
