import { supabase } from './supabase';
import type { WalletDoc, WalletTransactionDoc } from '../types/models';

function mapWalletRow(row: any): WalletDoc {
  return { walletId: row.id, balance: row.balance, bangkeroId: row.bangkero_id };
}

function mapTxRow(row: any): WalletTransactionDoc {
  return {
    transactionId: row.id,
    type: row.type,
    amount: row.amount,
    walletId: row.wallet_id,
    bookingId: row.booking_id,
  };
}

export async function getWallet(bangkeroId: string): Promise<WalletDoc | null> {
  const { data, error } = await supabase
    .from('wallets')
    .select('*')
    .eq('bangkero_id', bangkeroId)
    .maybeSingle();

  if (error) throw error;
  return data ? mapWalletRow(data) : null;
}

export async function getWalletTransactions(walletId: string): Promise<WalletTransactionDoc[]> {
  const { data, error } = await supabase
    .from('wallet_transactions')
    .select('*')
    .eq('wallet_id', walletId)
    .order('id', { ascending: false });

  if (error) throw error;
  return (data ?? []).map(mapTxRow);
}

export async function topUpWallet(walletId: string, amount: number): Promise<void> {
  const { error: txError } = await supabase
    .from('wallet_transactions')
    .insert({ wallet_id: walletId, type: 'top_up', amount });

  if (txError) throw txError;

  const { error: balError } = await supabase.rpc('increment_wallet_balance', {
    p_wallet_id: walletId,
    p_amount: amount,
  });

  if (balError) throw balError;
}

export async function creditWallet(
  walletId: string,
  amount: number,
  bookingId?: string
): Promise<void> {
  const { error: txError } = await supabase
    .from('wallet_transactions')
    .insert({ wallet_id: walletId, type: 'credit', amount, booking_id: bookingId ?? null });

  if (txError) throw txError;

  const { error: balError } = await supabase.rpc('increment_wallet_balance', {
    p_wallet_id: walletId,
    p_amount: amount,
  });

  if (balError) throw balError;
}

export async function debitWallet(walletId: string, amount: number): Promise<void> {
  const { error: txError } = await supabase
    .from('wallet_transactions')
    .insert({ wallet_id: walletId, type: 'debit', amount });

  if (txError) throw txError;

  const { error: balError } = await supabase.rpc('increment_wallet_balance', {
    p_wallet_id: walletId,
    p_amount: -amount,
  });

  if (balError) throw balError;
}
