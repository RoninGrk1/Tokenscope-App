import type { Env } from './env';
import { HttpError, cors, err, json, readJson } from './util';
import { authorize } from './limits';
import { cachedScan, compare, launches, parseToken, tokenInfo } from './scanner';
import { mcpHandler } from './mcp';
import { createInvoice, expireInvoices, getInvoice, submitTx } from './checkout';
import { runSolanaMatcher } from './solana';
import { runEthereumMatcher } from './ethereum';
import { runExpiryReminders, runWatchWorker } from './alerts';
import { addWatch, deleteWatch, listWatches } from './watches';
import { activeSubscription, rotateApiKey, sessionUser, startMagicLink, verifyMagicLink } from './auth';
import { createTelegramLinkCode, telegramWebhook } from './telegram';

async function route(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const p = url.pathname;
  const q = url.searchParams;
  const M = req.method;
  let m: RegExpMatchArray | null;

  if (p === '/api/health') return json({ ok: true, service: 'tokenscope', time: new Date().toISOString() });

  // ---- Scanner API
  if (p === '/api/v1/scan' && M === 'GET') {
    const a = await authorize(env, req, 'scan'); const t = parseToken(q.get('chain'), q.get('address'));
    return json(await cachedScan(env, t.chain, t.address), 200, a.remaining != null ? { 'x-ratelimit-remaining': String(a.remaining) } : {});
  }
  if (p === '/api/v1/token' && M === 'GET') { await authorize(env, req, 'token'); const t = parseToken(q.get('chain'), q.get('address')); return json(await tokenInfo(env, t.chain, t.address)); }
  if (p === '/api/v1/compare' && M === 'GET') {
    await authorize(env, req, 'compare');
    const tokens = (q.get('tokens') ?? '').split(',').filter(Boolean).map((s) => { const [c, a] = s.includes(':') ? s.split(':') : ['', s]; return parseToken(c, a); });
    return json(await compare(env, tokens));
  }
  if (p === '/api/v1/launches' && M === 'GET') { await authorize(env, req, 'launches'); return json(await launches(env, q.get('chain') ?? undefined)); }
  if (p === '/api/v1/watches') {
    const a = await authorize(env, req, 'watch');
    if (M === 'GET') return json(await listWatches(env, a.user!));
    if (M === 'POST') return json(await addWatch(env, a.user!, a.sub, await readJson(req)), 201);
  }
  if ((m = p.match(/^\/api\/v1\/watches\/([\w]+)$/)) && M === 'DELETE') { const a = await authorize(env, req, 'watch'); await deleteWatch(env, a.user!, m[1]); return json({ ok: true }); }

  // ---- MCP
  if (p === '/mcp') return mcpHandler(env, req);

  // ---- Checkout
  if (p === '/api/checkout/invoices' && M === 'POST') return json(await createInvoice(env, req), 201);
  if ((m = p.match(/^\/api\/checkout\/invoices\/(inv_[0-9a-f]+)$/)) && M === 'GET') return json(await getInvoice(env, m[1]));
  if ((m = p.match(/^\/api\/checkout\/invoices\/(inv_[0-9a-f]+)\/tx$/)) && M === 'POST') return json(await submitTx(env, req, m[1]));

  // ---- Auth (magic link) + account
  if (p === '/api/auth/magic-link' && M === 'POST') { await startMagicLink(env, (await readJson<{ email: string }>(req)).email); return json({ ok: true }); }
  if (p === '/api/auth/verify' && M === 'GET') {
    const { cookie } = await verifyMagicLink(env, q.get('token') ?? '');
    return new Response(null, { status: 302, headers: { location: `${env.APP_URL}/account`, 'set-cookie': cookie } });
  }
  if (p.startsWith('/api/account')) {
    const user = await sessionUser(env, req); if (!user) throw new HttpError(401, 'Sign in first');
    if (p === '/api/account' && M === 'GET') {
      const sub = await activeSubscription(env, user.id);
      const credits = await env.DB.prepare('SELECT balance FROM credits WHERE user_id = ?').bind(user.id).first<{ balance: number }>();
      const keys = await env.DB.prepare('SELECT prefix, created_at FROM api_keys WHERE user_id = ? AND revoked_at IS NULL').bind(user.id).all();
      const invoices = await env.DB.prepare('SELECT id, chain, amount_display, status, created_at, paid_at, tx_hash FROM invoices WHERE user_id = ? ORDER BY created_at DESC LIMIT 50').bind(user.id).all();
      return json({ user: { email: user.email, telegramLinked: !!user.telegram_chat_id }, subscription: sub, credits: credits?.balance ?? 0, keys: keys.results, invoices: invoices.results });
    }
    if (p === '/api/account/keys' && M === 'POST') return json({ apiKey: await rotateApiKey(env, user.id) }, 201);
    if (p === '/api/account/telegram-link' && M === 'POST') return json({ code: await createTelegramLinkCode(env, user), instructions: 'Send /start <code> to the Tokenscope bot within 10 minutes.' });
  }

  // ---- Telegram bot
  if (p === '/api/telegram/webhook' && M === 'POST') return telegramWebhook(env, req);

  // ---- Admin: payment ledger export (UK: record every payment as income)
  if (p === '/api/admin/payments.csv' && M === 'GET') {
    if (!env.ADMIN_TOKEN || req.headers.get('authorization') !== `Bearer ${env.ADMIN_TOKEN}`) throw new HttpError(401, 'unauthorized');
    const { results } = await env.DB.prepare('SELECT p.received_at, p.chain, p.tx_hash, p.payer, p.amount_units, p.usd_value, p.invoice_id, i.product FROM payments p JOIN invoices i ON i.id = p.invoice_id ORDER BY p.received_at').all<any>();
    const csv = ['received_at_utc,chain,tx_hash,payer,usdc,usd_value,invoice_id,product', ...results.map((r) =>
      [new Date(r.received_at).toISOString(), r.chain, r.tx_hash, r.payer, (Number(r.amount_units) / 1e6).toFixed(6), r.usd_value, r.invoice_id, `"${String(r.product).replace(/"/g, '""')}"`].join(','))].join('\n');
    return new Response(csv, { headers: { 'content-type': 'text/csv' } });
  }

  return err(404, 'Not found');
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === 'OPTIONS') return cors(req, env, new Response(null, { status: 204 }));
    try { return cors(req, env, await route(req, env)); }
    catch (e) {
      if (e instanceof HttpError) return cors(req, env, err(e.status, e.message, e.extra));
      console.error(e);
      return cors(req, env, err(500, 'Internal error'));
    }
  },

  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    switch (event.cron) {
      case '* * * * *':
        ctx.waitUntil((async () => {
          await expireInvoices(env);
          await Promise.allSettled([runSolanaMatcher(env), runEthereumMatcher(env)]);
        })());
        break;
      case '*/10 * * * *': ctx.waitUntil(runWatchWorker(env)); break;
      case '0 9 * * *': ctx.waitUntil(runExpiryReminders(env)); break;
    }
  },
} satisfies ExportedHandler<Env>;
