import type { Env } from './env';
import { HttpError, getCookie, now, randomId, sha256Hex } from './util';
import { sendEmail } from './email';
import { DAY_MS, PLANS, type PlanId } from '../../shared/pricing';

export interface User { id: string; email: string | null; telegram_chat_id: string | null }
export interface Subscription { user_id: string; plan: PlanId; period_days: number; paid_usd: number; period_start: number; expires_at: number }

const MAGIC_TTL = 15 * 60_000;
const SESSION_TTL = 30 * DAY_MS;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function findOrCreateUser(env: Env, email: string | null): Promise<User> {
  if (email) {
    const u = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email.toLowerCase()).first<User>();
    if (u) return u;
  }
  const id = randomId('u_', 12);
  await env.DB.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)').bind(id, email?.toLowerCase() ?? null, now()).run();
  return { id, email: email?.toLowerCase() ?? null, telegram_chat_id: null };
}

export async function startMagicLink(env: Env, emailRaw: string): Promise<void> {
  const email = String(emailRaw ?? '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Invalid email');
  const token = randomId('', 24);
  await env.DB.prepare('INSERT INTO magic_links (token_hash, email, expires_at) VALUES (?, ?, ?)').bind(await sha256Hex(token), email, now() + MAGIC_TTL).run();
  const link = `${env.APP_URL}/api/auth/verify?token=${token}`;
  await sendEmail(env, email, 'Your Tokenscope sign-in link', `Sign in to Tokenscope:\n\n${link}\n\nThis link expires in 15 minutes. If you didn't request it, ignore this email.`);
}

export async function verifyMagicLink(env: Env, token: string): Promise<{ cookie: string; user: User }> {
  const hash = await sha256Hex(token);
  const row = await env.DB.prepare('SELECT * FROM magic_links WHERE token_hash = ?').bind(hash).first<{ email: string; expires_at: number; used_at: number | null }>();
  if (!row || row.used_at || row.expires_at < now()) throw new HttpError(400, 'Link expired or already used');
  await env.DB.prepare('UPDATE magic_links SET used_at = ? WHERE token_hash = ?').bind(now(), hash).run();
  const user = await findOrCreateUser(env, row.email);
  const sid = randomId('', 24);
  await env.DB.prepare('INSERT INTO sessions (id_hash, user_id, expires_at) VALUES (?, ?, ?)').bind(await sha256Hex(sid), user.id, now() + SESSION_TTL).run();
  return { user, cookie: `ts_session=${sid}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL / 1000}` };
}

export async function sessionUser(env: Env, req: Request): Promise<User | null> {
  const sid = getCookie(req, 'ts_session'); if (!sid) return null;
  return env.DB.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id_hash = ? AND s.expires_at > ?').bind(await sha256Hex(sid), now()).first<User>();
}

/** Issue a new API key. The plaintext is returned once; only its hash is stored. */
export async function createApiKey(env: Env, userId: string): Promise<string> {
  const key = randomId('ts_live_', 24);
  await env.DB.prepare('INSERT INTO api_keys (id, user_id, key_hash, prefix, created_at) VALUES (?, ?, ?, ?, ?)').bind(randomId('k_', 8), userId, await sha256Hex(key), key.slice(0, 12), now()).run();
  return key;
}

export async function rotateApiKey(env: Env, userId: string): Promise<string> {
  await env.DB.prepare('UPDATE api_keys SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').bind(now(), userId).run();
  return createApiKey(env, userId);
}

export async function apiKeyUser(env: Env, req: Request): Promise<User | null> {
  const h = req.headers.get('authorization') ?? '';
  const key = h.startsWith('Bearer ') ? h.slice(7).trim() : new URL(req.url).searchParams.get('api_key');
  if (!key) return null;
  const u = await env.DB.prepare('SELECT u.* FROM api_keys k JOIN users u ON u.id = k.user_id WHERE k.key_hash = ? AND k.revoked_at IS NULL').bind(await sha256Hex(key)).first<User>();
  if (!u) throw new HttpError(401, 'Invalid or revoked API key');
  return u;
}

export async function activeSubscription(env: Env, userId: string): Promise<Subscription | null> {
  return env.DB.prepare('SELECT * FROM subscriptions WHERE user_id = ? AND expires_at > ?').bind(userId, now()).first<Subscription>();
}

export function planOf(sub: Subscription | null) { return sub ? PLANS[sub.plan] : null; }
