import type { Env } from './env';
import { now, randomId } from './util';
import { createApiKey, findOrCreateUser } from './auth';
import { sendEmail } from './email';
import { CREDIT_PACKS, PLANS, stackExpiry, type ProductRef } from '../../shared/pricing';

export interface InvoiceRow {
  id: string; user_id: string | null; email: string | null; product: string; chain: 'ethereum' | 'solana'; price_usd: number;
  amount_units: string; amount_display: string; recipient: string; token: string; reference: string | null;
  status: 'pending' | 'confirming' | 'paid' | 'expired'; tx_hash: string | null; created_at: number; expires_at: number; paid_at: number | null; api_key_once: string | null;
}

export interface PaymentProof { txHash: string; payer: string | null; amountUnits: bigint; blockRef: string }

/**
 * Mark an invoice paid, record the payment in the ledger, then activate the plan or add credits
 * and issue an API key if the user doesn't have one. Idempotent: a tx hash can only pay once.
 */
export async function activateInvoice(env: Env, inv: InvoiceRow, proof: PaymentProof): Promise<boolean> {
  const t = now();
  const ins = await env.DB.prepare('INSERT OR IGNORE INTO payments (id, invoice_id, chain, tx_hash, payer, amount_units, usd_value, block_ref, received_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(randomId('p_', 10), inv.id, inv.chain, proof.txHash, proof.payer, proof.amountUnits.toString(), Number(proof.amountUnits) / 1e6, proof.blockRef, t).run();
  if (!ins.meta.changes) return false; // tx already used
  const upd = await env.DB.prepare("UPDATE invoices SET status = 'paid', paid_at = ?, tx_hash = ? WHERE id = ? AND status != 'paid'").bind(t, proof.txHash, inv.id).run();
  if (!upd.meta.changes) return false;

  const user = inv.user_id ? { id: inv.user_id, email: inv.email } : await findOrCreateUser(env, inv.email);
  if (!inv.user_id) await env.DB.prepare('UPDATE invoices SET user_id = ? WHERE id = ?').bind(user.id, inv.id).run();

  const product = JSON.parse(inv.product) as ProductRef & { mode?: 'renew' | 'switch' };
  let summary = '';
  if (product.kind === 'plan') {
    const cur = await env.DB.prepare('SELECT * FROM subscriptions WHERE user_id = ?').bind(user.id).first<{ plan: string; expires_at: number; period_start: number }>();
    const samePlan = cur && cur.plan === product.plan && cur.expires_at > t;
    const expires = samePlan ? stackExpiry(cur!.expires_at, t, product.days) : stackExpiry(null, t, product.days);
    const periodStart = samePlan ? cur!.period_start : t;
    await env.DB.prepare(`INSERT INTO subscriptions (user_id, plan, period_days, paid_usd, period_start, expires_at, reminder_sent_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, NULL, ?) ON CONFLICT(user_id) DO UPDATE SET plan = excluded.plan, period_days = excluded.period_days,
      paid_usd = excluded.paid_usd, period_start = excluded.period_start, expires_at = excluded.expires_at, reminder_sent_at = NULL, updated_at = excluded.updated_at`)
      .bind(user.id, product.plan, product.days, PLANS[product.plan].prices[product.days], periodStart, expires, t).run();
    summary = `${PLANS[product.plan].name} active until ${new Date(expires).toUTCString()}`;
  } else {
    const pack = CREDIT_PACKS.find((c) => c.id === product.pack)!;
    await env.DB.prepare('INSERT INTO credits (user_id, balance) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET balance = balance + excluded.balance').bind(user.id, pack.calls).run();
    summary = `${pack.calls.toLocaleString('en-US')} API credits added`;
  }

  const hasKey = await env.DB.prepare('SELECT 1 FROM api_keys WHERE user_id = ? AND revoked_at IS NULL').bind(user.id).first();
  let key: string | null = null;
  if (!hasKey) {
    key = await createApiKey(env, user.id);
    await env.DB.prepare('UPDATE invoices SET api_key_once = ? WHERE id = ?').bind(key, inv.id).run();
  }
  if (user.email) {
    await sendEmail(env, user.email, 'Tokenscope payment confirmed', `Thanks! We received ${inv.amount_display} USDC on ${inv.chain} (tx ${proof.txHash}).\n\n${summary}.\n${key ? `\nYour API key: ${key}\nKeep it secret. You can rotate it from your account page.\n` : ''}\nInvoice: ${inv.id}\nRefunds: manual, within 7 days of purchase, only if the service was down.`);
  }
  console.log(`invoice ${inv.id} paid: ${summary}`);
  return true;
}
