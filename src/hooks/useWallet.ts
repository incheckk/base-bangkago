import { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';
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

    const channel = supabase
      .channel('wallet-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wallets', filter: `bangkero_id=eq.${bangkeroId}` }, load)
      .subscribe();

    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, [bangkeroId]);

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
