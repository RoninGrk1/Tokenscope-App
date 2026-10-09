import type { Env } from './env';
import { HttpError, now, randomId } from './util';
import type { Subscription, User } from './auth';
import { watchLimit } from './limits';
import { parseToken, cachedScan } from './scanner';
import { PLANS } from '../../shared/pricing';

export async function addWatch(env: Env, user: User, sub: Subscription | null, input: { chain?: string; address?: string; channel?: string; target?: string }) {
  const { chain, address } = parseToken(input.chain, input.address);
  const channel = (input.channel ?? (user.telegram_chat_id ? 'telegram' : 'email')) as 'telegram' | 'discord' | 'email';
  if (!['telegram', 'discord', 'email'].includes(channel)) throw new HttpError(400, 'channel must be telegram, discord or email');
  if (channel === 'discord' && !sub?.plan) throw new HttpError(402, 'Discord alerts need a plan');
  if (channel === 'discord' && sub && !PLANS[sub.plan].limits.teamAlerts) throw new HttpError(402, 'Discord team alerts are part of the Alerts Team plan.');
  const target = channel === 'telegram' ? (input.target ?? user.telegram_chat_id) : channel === 'email' ? (input.target ?? user.email) : input.target;
  if (!target) throw new HttpError(400, channel === 'telegram' ? 'Link Telegram first: message the bot /start' : 'target is required');
  await watchLimit(env, user, sub);
  const r = await cachedScan(env, chain, address);
  const id = randomId('w_', 8);
  await env.DB.prepare('INSERT OR IGNORE INTO watches (id, user_id, chain, address, channel, target, last_score, last_level, last_checked_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, user.id, chain, address, channel, target, r.score, r.level, now(), now()).run();
  return { id, chain, address, channel, current: { score: r.score, level: r.level, verdict: r.verdict } };
}

export async function listWatches(env: Env, user: User) {
  const { results } = await env.DB.prepare('SELECT id, chain, address, channel, last_score, last_level, last_checked_at FROM watches WHERE user_id = ? ORDER BY created_at DESC').bind(user.id).all();
  return results;
}

export async function deleteWatch(env: Env, user: User, id: string) {
  await env.DB.prepare('DELETE FROM watches WHERE id = ? AND user_id = ?').bind(id, user.id).run();
}
