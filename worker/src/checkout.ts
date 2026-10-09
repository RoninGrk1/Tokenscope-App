import type { Env } from './env';
import { receivingAddressesOk } from './env';
import { HttpError, now, randomId, readJson } from './util';
import { activeSubscription, findOrCreateUser, sessionUser } from './auth';
import { verifyEthTx } from './ethereum';
import { matchSolanaInvoice } from './solana';
import type { InvoiceRow } from './activate';
import { RECEIVING, USDC } from '../../shared/config';
import { CREDIT_PACKS, INVOICE_TTL_MINUTES, PERIODS, PLANS, ethUniqueAmount, productLabel, productPrice, proratedUpgradePrice, toUnits, type ProductRef } from '../../shared/pricing';
import { solanaPayUrl, eip681UsdcUrl } from '../../shared/payments';
import { randomReference } from '../../shared/base58';

function validProduct(p: any): ProductRef {
  if (p?.kind === 'plan' && PLANS[p.plan as keyof typeof PLANS] && PERIODS.includes(p.days)) return { kind: 'plan', plan: p.plan, days: p.days };
  if (p?.kind === 'credits' && CREDIT_PACKS.some((c) => c.id === p.pack)) return { kind: 'credits', pack: p.pack };
  throw new HttpError(400, 'Unknown product');
}

function publicInvoice(inv: InvoiceRow) {
  const sol = inv.chain === 'solana';
  return {
    id: inv.id, chain: inv.chain, status: inv.status, amount: inv.amount_display, amountUnits: inv.amount_units,
    recipient: inv.recipient, token: inv.token, reference: inv.reference ?? undefined, expiresAt: inv.expires_at, txHash: inv.tx_hash,
    paymentUrl: sol ? solanaPayUrl({ amount: inv.amount_display, reference: inv.reference!, label: 'Tokenscope', message: productLabel(JSON.parse(inv.product)) }) : eip681UsdcUrl(BigInt(inv.amount_units)),
  };
}

export async function createInvoice(env: Env, req: Request) {
  if (!receivingAddressesOk(env)) throw new HttpError(503, 'Checkout disabled: receiving address configuration mismatch.');
  const body = await readJson<{ product: unknown; chain: string; email?: string }>(req);
  const product = validProduct(body.product);
  const chain = body.chain === 'ethereum' ? 'ethereum' : 'solana';
  const email = body.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email) ? body.email.trim().toLowerCase() : null;
  const user = (await sessionUser(env, req)) ?? (email ? await findOrCreateUser(env, email) : null);

  let price = productPrice(product);
  let mode: 'renew' | 'switch' = 'renew';
  if (product.kind === 'plan' && user) {
    const sub = await activeSubscription(env, user.id);
    if (sub && sub.plan !== product.plan) {
      // Mid-period plan change: credit the unused days of the current plan.
      mode = 'switch';
      price = proratedUpgradePrice({ currentPaid: sub.paid_usd, currentDays: sub.period_days, currentExpiresAt: sub.expires_at, now: now(), newPrice: price }).due;
      if (price <= 0) throw new HttpError(400, 'Your remaining credit covers this change; contact support to switch.');
    }
  }

  const id = randomId('inv_', 10);
  const created = now();
  const expires = created + INVOICE_TTL_MINUTES * 60_000;
  let amountUnits: bigint, display: string, reference: string | null = null;
  if (chain === 'solana') {
    reference = randomReference(); amountUnits = toUnits(price); display = String(Number(price.toFixed(2)));
  } else {
    // Unique cents suffix: no other open/recent invoice may expect the exact same amount.
    let pick: { display: string; units: bigint } | null = null;
    for (let i = 0; i < 25 && !pick; i++) {
      const cand = ethUniqueAmount(price, 1 + Math.floor(Math.random() * 9999));
      const clash = await env.DB.prepare("SELECT 1 FROM invoices WHERE chain = 'ethereum' AND amount_units = ? AND (status IN ('pending','confirming') OR expires_at > ?)")
        .bind(cand.units.toString(), created - Number(env.PAYMENT_GRACE_MINUTES) * 60_000).first();
      if (!clash) pick = cand;
    }
    if (!pick) throw new HttpError(503, 'Checkout busy, please retry.');
    amountUnits = pick.units; display = pick.display;
  }
  const row: InvoiceRow = {
    id, user_id: user?.id ?? null, email: email ?? user?.email ?? null, product: JSON.stringify({ ...product, mode }), chain, price_usd: price,
    amount_units: amountUnits.toString(), amount_display: display, recipient: chain === 'solana' ? RECEIVING.solana : RECEIVING.ethereum,
    token: chain === 'solana' ? USDC.solana.mint : USDC.ethereum.address, reference, status: 'pending', tx_hash: null, created_at: created, expires_at: expires, paid_at: null, api_key_once: null,
  };
  await env.DB.prepare(`INSERT INTO invoices (id, user_id, email, product, chain, price_usd, amount_units, amount_display, recipient, token, reference, status, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`)
    .bind(row.id, row.user_id, row.email, row.product, row.chain, row.price_usd, row.amount_units, row.amount_display, row.recipient, row.token, row.reference, row.created_at, row.expires_at).run();
  return { ...publicInvoice(row), mode, priceUsd: price };
}

export async function getInvoice(env: Env, id: string) {
  const inv = await env.DB.prepare('SELECT * FROM invoices WHERE id = ?').bind(id).first<InvoiceRow>();
  if (!inv) throw new HttpError(404, 'Invoice not found');
  // Opportunistic check so the customer doesn't have to wait for the cron.
  if (inv.status === 'pending' && inv.chain === 'solana') { try { if (await matchSolanaInvoice(env, inv)) return getInvoice(env, id); } catch { /* cron will retry */ } }
  let apiKey: string | undefined;
  if (inv.status === 'paid' && inv.api_key_once) {
    apiKey = inv.api_key_once;
    await env.DB.prepare('UPDATE invoices SET api_key_once = NULL WHERE id = ?').bind(id).run(); // shown once
  }
  return { ...publicInvoice(inv), apiKey };
}

export async function submitTx(env: Env, req: Request, id: string) {
  const { txHash } = await readJson<{ txHash: string }>(req);
  const inv = await env.DB.prepare('SELECT * FROM invoices WHERE id = ?').bind(id).first<InvoiceRow>();
  if (!inv) throw new HttpError(404, 'Invoice not found');
  if (inv.chain !== 'ethereum') throw new HttpError(400, 'Tx hash submission is for Ethereum invoices');
  if (inv.status === 'paid') return { status: 'paid' };
  const status = await verifyEthTx(env, inv, String(txHash ?? '').trim());
  if (status === 'invalid') throw new HttpError(400, 'That transaction is not a matching USDC payment for this invoice.');
  return { status };
}

export async function expireInvoices(env: Env) {
  await env.DB.prepare("UPDATE invoices SET status = 'expired' WHERE status = 'pending' AND expires_at < ?").bind(now()).run();
}
