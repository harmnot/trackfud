/**
 * Earnings wallet: live server balances from B5 (`GET /courier/earnings`,
 * `GET+POST /courier/withdrawals`) with the IndexedDB ledger as the
 * offline mirror. Delivery credits land locally at once (instant
 * feedback); the server remains the source of truth for withdrawable
 * money. Amounts are integer minor units, never floats.
 */
import { create } from 'zustand';
import { db, type WalletTx } from '../../lib/db';
import { logger } from '../../lib/logger';
import { createWithdrawal, fetchEarnings, listWithdrawals, type WithdrawalRow } from '../delivery/courierApi';

/** Live server balance for one currency (openapi `getEarnings` row). */
export type ServerBalance = {
  currency: string;
  balanceMinor: number;
  withdrawableMinor: number;
  lifetimeMinor: number;
};

type WalletState = {
  txs: WalletTx[];
  currency: string;
  loaded: boolean;
  /** Live server balances (empty while offline); first row is primary. */
  server: ServerBalance[];
  serverLoaded: boolean;
  withdrawals: WithdrawalRow[];
  load: () => Promise<void>;
  /** Refresh live balances + withdrawal history (B5); keeps IDB on failure. */
  sync: () => Promise<void>;
  creditDelivery: (args: { feeMinor: number; currency: string; label: string }) => Promise<void>;
  withdraw: (args: { amountMinor: number }) => Promise<{ ok: boolean; reason?: string }>;
  /** Real payout first; `{ reason: 'offline-mock' }` asks the caller to confirm the labelled mock path. */
  withdrawReal: (args: { amountMinor: number; currency: string }) => Promise<{ ok: boolean; reason?: string }>;
};

export function balanceMinor(txs: WalletTx[]): number {
  return txs.reduce((sum, t) => sum + t.amountMinor, 0);
}

export const useWallet = create<WalletState>((set, get) => ({
  txs: [],
  currency: 'IDR',
  loaded: false,
  server: [],
  serverLoaded: false,
  withdrawals: [],
  load: async () => {
    try {
      const txs = await db.wallet.orderBy('ts').toArray();
      const last = txs[txs.length - 1];
      set({ txs, currency: last?.currency ?? get().currency, loaded: true });
    } catch (err) {
      logger.error('wallet load failed', err);
      set({ loaded: true });
    }
    await get().sync();
  },
  sync: async () => {
    try {
      const [earnings, history] = await Promise.all([fetchEarnings(), listWithdrawals()]);
      const server: ServerBalance[] = earnings.map((e) => ({
        currency: e.currency,
        balanceMinor: e.balance.amount_minor,
        withdrawableMinor: e.withdrawable.amount_minor,
        lifetimeMinor: e.lifetime_earned.amount_minor,
      }));
      const primary = server[0];
      set({
        server,
        serverLoaded: true,
        withdrawals: history,
        currency: primary ? primary.currency : get().currency,
      });
    } catch (err) {
      logger.warn('wallet sync failed, offline mirror owns the view', err);
      set({ serverLoaded: true });
    }
  },
  creditDelivery: async ({ feeMinor, currency, label }) => {
    const tx: WalletTx = {
      id: crypto.randomUUID(),
      ts: Date.now(),
      kind: 'delivery',
      amountMinor: feeMinor,
      currency,
      label,
    };
    try {
      await db.wallet.add(tx);
    } catch (err) {
      logger.error('wallet credit failed', err);
      return;
    }
    set({ txs: [...get().txs, tx], currency });
  },
  withdrawReal: async ({ amountMinor, currency }) => {
    if (amountMinor <= 0) return { ok: false, reason: 'amount' };
    try {
      const row = await createWithdrawal({ amountMinor, currency });
      const tx: WalletTx = {
        id: row.id,
        ts: Date.parse(row.created_at) || Date.now(),
        kind: 'withdraw',
        amountMinor: -row.amount.amount_minor,
        currency: row.amount.currency,
        label: `withdraw-${row.status}`,
      };
      try {
        await db.wallet.add(tx);
      } catch (err) {
        logger.error('withdraw mirror save failed', err);
      }
      set({ txs: [...get().txs, tx] });
      await get().sync();
      return { ok: true };
    } catch (err) {
      logger.warn('server withdrawal failed', err);
      return { ok: false, reason: 'offline-mock' };
    }
  },
  withdraw: async ({ amountMinor }) => {
    if (amountMinor <= 0) return { ok: false, reason: 'amount' };
    if (balanceMinor(get().txs) < amountMinor) return { ok: false, reason: 'balance' };
    const tx: WalletTx = {
      id: crypto.randomUUID(),
      ts: Date.now(),
      kind: 'withdraw',
      amountMinor: -amountMinor,
      currency: get().currency,
      label: 'withdraw-mock',
    };
    try {
      await db.wallet.add(tx);
    } catch (err) {
      logger.error('withdraw failed', err);
      return { ok: false, reason: 'storage' };
    }
    set({ txs: [...get().txs, tx] });
    return { ok: true };
  },
}));
