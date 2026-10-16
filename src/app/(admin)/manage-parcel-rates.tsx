import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { AdminScreenHeader } from '@/components/AdminScreenHeader';
import { PrimaryButton } from '@/components/PrimaryButton';
import { ScreenContainer } from '@/components/ScreenContainer';
import { ErrorState, LoadingState } from '@/components/States';
import { TextField } from '@/components/TextField';
import { supabase } from '@/services/supabase';
import { colors, radii, spacing, typography } from '@/theme/tokens';

export default function ManageParcelRates() {
  const [row, setRow] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // State for each editable field (strings for TextField)
  const [baseAcc, setBaseAcc] = useState('');
  const [basePig, setBasePig] = useState('');
  const [baseBat, setBaseBat] = useState('');
  const [soloSur, setSoloSur] = useState('');
  const [incKg, setIncKg] = useState('');
  const [exRate, setExRate] = useState('');
  const [minKg, setMinKg] = useState('');
  const [maxKg, setMaxKg] = useState('');
  const [isActive, setIsActive] = useState(true);

  const load = useCallback(async () => {
    const { data, error: err } = await supabase
      .from('parcel_rates')
      .select('*')
      .eq('zone', 'mactan-olango')
      .maybeSingle();
    if (err || !data) { setError('Failed to load rates'); setLoading(false); return; }
    setRow(data);
    setBaseAcc(String(data.base_fee_accompanied));
    setBasePig(String(data.base_fee_piggyback));
    setBaseBat(String(data.base_fee_batched));
    setSoloSur(String(data.solo_surcharge));
    setIncKg(String(data.included_kg));
    setExRate(String(data.excess_rate_per_kg));
    setMinKg(String(data.min_kg));
    setMaxKg(String(data.max_kg));
    setIsActive(data.is_active);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleSave = async () => {
    if (!row) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    const { error: err } = await supabase
      .from('parcel_rates')
      .update({
        base_fee_accompanied: parseFloat(baseAcc) || 0,
        base_fee_piggyback: parseFloat(basePig) || 0,
        base_fee_batched: parseFloat(baseBat) || 0,
        solo_surcharge: parseFloat(soloSur) || 0,
        included_kg: parseFloat(incKg) || 0,
        excess_rate_per_kg: parseFloat(exRate) || 0,
        min_kg: parseFloat(minKg) || 0,
        max_kg: parseFloat(maxKg) || 0,
        is_active: isActive,
        updated_at: new Date().toISOString(),
      })
      .eq('zone', 'mactan-olango');
    setSaving(false);
    if (err) { setError(err.message); return; }
    setMessage('Rates saved');
  };

  if (loading) return <LoadingState />;
  if (error && !row) return <ErrorState message={error} />;
  if (!row) return <ErrorState message="No rate row found" />;

  return (
    <ScreenContainer padded={false}>
      <AdminScreenHeader title="Parcel Rates" subtitle={`Zone: ${row.zone}`} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
        <View style={styles.formCard}>
          <TextField label="Base fee (accompanied ₱)" value={baseAcc} onChangeText={setBaseAcc} keyboardType="numeric" />
          <TextField label="Base fee (piggyback ₱)" value={basePig} onChangeText={setBasePig} keyboardType="numeric" />
          <TextField label="Base fee (batched ₱)" value={baseBat} onChangeText={setBaseBat} keyboardType="numeric" />
          <TextField label="Solo surcharge (₱)" value={soloSur} onChangeText={setSoloSur} keyboardType="numeric" />
          <TextField label="Included weight (kg)" value={incKg} onChangeText={setIncKg} keyboardType="numeric" />
          <TextField label="Excess rate (₱/kg)" value={exRate} onChangeText={setExRate} keyboardType="numeric" />
          <TextField label="Minimum weight (kg)" value={minKg} onChangeText={setMinKg} keyboardType="numeric" />
          <TextField label="Maximum weight (kg)" value={maxKg} onChangeText={setMaxKg} keyboardType="numeric" />

          {/* Active toggle as a checkbox row */}
          <View style={styles.toggleRow}>
            <Text style={styles.toggleLabel}>Rates active</Text>
            <Switch value={isActive} onValueChange={setIsActive} />
          </View>

          {error && <Text style={styles.errorText}>{error}</Text>}
          {message && <Text style={styles.successText}>{message}</Text>}

          <PrimaryButton label={saving ? 'Saving…' : 'Save rates'} onPress={() => void handleSave()} disabled={saving} loading={saving} />
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  formCard: { backgroundColor: colors.surface, padding: spacing.lg, borderRadius: radii.md, borderWidth: 1, borderColor: colors.warning, gap: spacing.md },
  toggleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.sm },
  toggleLabel: { ...typography.body },
  errorText: { color: colors.danger, fontSize: 13, marginTop: spacing.sm },
  successText: { color: colors.primary, fontSize: 13, marginTop: spacing.sm },
});
