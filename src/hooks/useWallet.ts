import { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';
import { useChannelId } from './useChannelId';
import { getWallet, getWalletTransactions, topUpWallet } from '../services/wallet.service';
import type { WalletDoc, WalletTransactionDoc } from '../types/models';

interface Result {
  wallet: WalletDoc | null;
  transactions: WalletTransactionDoc[];
  loading: boolean;
  error: string | null;
  topUp: (amount: number) => Promise<void>;
}

export function useWallet(bangkeroId: string | null): Result {
  const [wallet, setWallet] = useState<WalletDoc | null>(null);
  const [transactions, setTransactions] = useState<WalletTransactionDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const channelId = useChannelId();

  useEffect(() => {
    if (!bangkeroId) { setWallet(null); setTransactions([]); setLoading(false); return; }
    let cancelled = false;

    const load = async () => {
      try {
        const w = await getWallet(bangkeroId);
        if (cancelled) return;
        setWallet(w);
        if (w) {
          const txs = await getWalletTransactions(w.walletId);
          if (cancelled) return;
          setTransactions(txs);
        }
        setLoading(false);
        setError(null);
      } catch (e: any) {
        if (cancelled) return;
        setError(e.message ?? 'Failed to load wallet');
        setLoading(false);
      }
    };

    load();

    let channel: ReturnType<typeof supabase.channel> | null = null;
    try {
      channel = supabase.channel(`wallet-changes-${channelId}`);
      channel
        .on('postgres_changes', { event: '*', schema: 'public', table: 'wallets', filter: `bangkero_id=eq.${bangkeroId}` }, load)
        .subscribe();
    } catch {
      // realtime unavailable — the screen keeps working without live updates
    }

    return () => { cancelled = true; if (channel) supabase.removeChannel(channel); };
  }, [bangkeroId, channelId]);

  const topUp = async (amount: number) => {
    if (!wallet) return;
    try {
      await topUpWallet(wallet.walletId, amount);
      const w = await getWallet(bangkeroId!);
      setWallet(w);
      if (w) {
        const txs = await getWalletTransactions(w.walletId);
        setTransactions(txs);
      }
    } catch (e: any) {
      setError(e.message ?? 'Failed to top up');
    }
  };

  return { wallet, transactions, loading, error, topUp };
}
