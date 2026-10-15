import { useState, useEffect, useCallback, useRef } from 'react';
import { useRealtimeQuery } from './useRealtimeQuery';
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
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!bangkeroId) { setWallet(null); setTransactions([]); setLoading(false); return; }
    const id = ++seq.current;
    try {
      const w = await getWallet(bangkeroId);
      if (id !== seq.current) return;
      setWallet(w);
      if (w) {
        const txs = await getWalletTransactions(w.walletId);
        if (id !== seq.current) return;
        setTransactions(txs);
      } else {
        setTransactions([]);
      }
      setLoading(false);
      setError(null);
    } catch (e: any) {
      if (id !== seq.current) return;
      setError(e.message ?? 'Failed to load wallet');
      setLoading(false);
    }
  }, [bangkeroId]);

  useEffect(() => { void load(); }, [load]);
  // wallet_transactions is subscribed as well — history stays live even when
  // the balance row itself doesn't change (e.g. admin-side entries).
  useRealtimeQuery(
    load,
    bangkeroId
      ? [
          { table: 'wallets', filter: `bangkero_id=eq.${bangkeroId}` },
          { table: 'wallet_transactions' },
        ]
      : [],
  );

  // Throws on failure so the caller can toast it inline — swallowing it
  // into the load error would flip the whole screen to ErrorState.
  const topUp = async (amount: number) => {
    if (!wallet) return;
    await topUpWallet(wallet.walletId, amount);
    const w = await getWallet(bangkeroId!);
    setWallet(w);
    if (w) {
      const txs = await getWalletTransactions(w.walletId);
      setTransactions(txs);
    }
  };

  return { wallet, transactions, loading, error, topUp };
}
