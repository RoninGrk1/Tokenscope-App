import type { Env } from './env';
import { HttpError, clientIp } from './util';
import { activeSubscription, apiKeyUser, sessionUser, type Subscription, type User } from './auth';
import { FREE_LIMITS, PLANS } from '../../shared/pricing';

export type Feature = 'scan' | 'token' | 'compare' | 'launches' | 'watch' | 'mcp';

export interface Access { user: User | null; sub: Subscription | null; via: 'api_key' | 'session' | 'anonymous'; billedTo: 'free' | 'plan' | 'credits'; remaining: number | null }

async function bump(env: Env, subject: string, bucket: string): Promise<number> {
  const r = await env.DB.prepare('INSERT INTO usage (subject, bucket, count) VALUES (?, ?, 1) ON CONFLICT(subject, bucket) DO UPDATE SET count = count + 1 RETURNING count')
    .bind(subject, bucket).first<{ count: number }>();
  return r?.count ?? 1;
}

async function spendCredit(env: Env, userId: string): Promise<number | null> {
  const r = await env.DB.prepare('UPDATE credits SET balance = balance - 1 WHERE user_id = ? AND balance > 0 RETURNING balance').bind(userId).first<{ balance: number }>();
  return r ? r.balance : null;
}

/**
 * Access rules:
 *  - API key (Bearer): API + MCP need an active Builder plan (50k calls/period) or credits.
 *  - Website session: plan features (Pro/Alerts: unlimited scans, compare, watches).
 *  - Anonymous: free daily limit per IP for scan/token only.
 */
export async function authorize(env: Env, req: Request, feature: Feature): Promise<Access> {
  const keyUser = await apiKeyUser(env, req);
  const user = keyUser ?? (await sessionUser(env, req));
  const day = new Date().toISOString().slice(0, 10);

  if (!user) {
    if (feature !== 'scan' && feature !== 'token') throw new HttpError(401, 'This endpoint needs an API key (Builder plan or credits).', { pricing: '/pricing' });
    const n = await bump(env, `ip:${clientIp(req)}`, day);
    if (n > FREE_LIMITS.apiCallsPerDay) throw new HttpError(429, 'Free daily limit reached. Get an API key for more.', { limit: FREE_LIMITS.apiCallsPerDay });
    return { user: null, sub: null, via: 'anonymous', billedTo: 'free', remaining: FREE_LIMITS.apiCallsPerDay - n };
  }

  const sub = await activeSubscription(env, user.id);
  const plan = sub ? PLANS[sub.plan] : null;
  const via = keyUser ? 'api_key' : 'session';

  // Feature gates that don't depend on how the call is billed.
  if (feature === 'watch' && !plan?.limits.watches) throw new HttpError(402, 'Watches need a Pro, Builder or Alerts Team plan.');

  if (via === 'session' && plan && feature !== 'mcp' && (feature !== 'launches' || plan.limits.launches)) {
    return { user, sub, via, billedTo: 'plan', remaining: null };
  }
  if (plan?.limits.mcp) {
    const n = await bump(env, `user:${user.id}`, `period:${sub!.period_start}`);
    if (n <= plan.limits.apiCallsPerPeriod) return { user, sub, via, billedTo: 'plan', remaining: plan.limits.apiCallsPerPeriod - n };
  }
  const left = await spendCredit(env, user.id);
  if (left != null) return { user, sub, via, billedTo: 'credits', remaining: left };
  if (plan?.limits.mcp) throw new HttpError(429, 'Builder plan call limit reached for this period. Buy credits to keep going.');
  throw new HttpError(402, 'API and MCP access need a Builder plan or pay-per-call credits.', { pricing: '/pricing' });
}

export async function watchLimit(env: Env, user: User, sub: Subscription | null): Promise<void> {
  const max = sub ? PLANS[sub.plan].limits.watches : 0;
  const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM watches WHERE user_id = ?').bind(user.id).first<{ n: number }>();
  if ((r?.n ?? 0) >= max) throw new HttpError(402, `Your plan allows ${max} watches.`);
}
