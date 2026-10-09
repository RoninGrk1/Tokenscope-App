import { solRpc } from './env';
import type { Env } from './env';
import { rpc } from './rpc';
import { now } from './util';
import { activateInvoice, type InvoiceRow } from './activate';
import { USDC } from '../../shared/config';

interface TokenBal { accountIndex: number; mint: string; owner?: string; uiTokenAmount: { amount: string } }

/**
 * Solana Pay matcher: each invoice has a unique reference key included in the transfer.
 * Find signatures for the reference (finalized only), then verify mint, recipient and amount
 * from the transaction's token balance changes.
 */
export async function matchSolanaInvoice(env: Env, inv: InvoiceRow): Promise<boolean> {
  if (!inv.reference) return false;
  const sigs = await rpc<{ signature: string; err: unknown }[]>(solRpc(env), 'getSignaturesForAddress', [inv.reference, { limit: 10, commitment: 'finalized' }]);
  for (const s of sigs) {
    if (s.err) continue;
    const tx = await rpc<any>(solRpc(env), 'getTransaction', [s.signature, { commitment: 'finalized', maxSupportedTransactionVersion: 0, encoding: 'jsonParsed' }]);
    if (!tx || tx.meta?.err) continue;
    if (tx.blockTime && tx.blockTime * 1000 < inv.created_at - 60_000) continue;
    const pre: TokenBal[] = tx.meta.preTokenBalances ?? [];
    const post: TokenBal[] = tx.meta.postTokenBalances ?? [];
    let delta = 0n;
    for (const p of post) {
      if (p.mint !== USDC.solana.mint || p.owner !== inv.recipient) continue;
      const before = pre.find((b) => b.accountIndex === p.accountIndex)?.uiTokenAmount.amount ?? '0';
      delta += BigInt(p.uiTokenAmount.amount) - BigInt(before);
    }
    if (delta < BigInt(inv.amount_units)) continue;
    const keys = tx.transaction?.message?.accountKeys ?? [];
    const payer = keys.find((k: any) => k.signer)?.pubkey ?? null;
    return activateInvoice(env, inv, { txHash: s.signature, payer, amountUnits: delta, blockRef: `slot:${tx.slot}` });
  }
  return false;
}

export async function runSolanaMatcher(env: Env) {
  const grace = Number(env.PAYMENT_GRACE_MINUTES) * 60_000;
  const { results } = await env.DB.prepare("SELECT * FROM invoices WHERE chain = 'solana' AND status IN ('pending','expired') AND expires_at > ? ORDER BY created_at DESC LIMIT 50")
    .bind(now() - grace).all<InvoiceRow>();
  for (const inv of results) {
    try { await matchSolanaInvoice(env, inv); } catch (e) { console.error('solana match', inv.id, e); }
    await new Promise((r) => setTimeout(r, 250)); // pace public RPC
  }
}
