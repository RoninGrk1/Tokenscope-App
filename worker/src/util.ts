import type { Env } from './env';

export const now = () => Date.now();

export function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });
}

export function err(status: number, message: string, extra: Record<string, unknown> = {}): Response {
  return json({ error: message, ...extra }, status);
}

export class HttpError extends Error { constructor(public status: number, message: string, public extra: Record<string, unknown> = {}) { super(message); } }

export function cors(req: Request, env: Env, res: Response): Response {
  const origin = req.headers.get('origin');
  const allowed = env.ALLOWED_ORIGINS.split(',').map((s) => s.trim());
  const h = new Headers(res.headers);
  if (origin && allowed.includes(origin)) { h.set('access-control-allow-origin', origin); h.set('access-control-allow-credentials', 'true'); h.append('vary', 'origin'); }
  else if (!origin || req.url.includes('/api/v1/') || req.url.endsWith('/mcp')) h.set('access-control-allow-origin', '*');
  h.set('access-control-allow-headers', 'authorization, content-type, mcp-session-id, mcp-protocol-version');
  h.set('access-control-allow-methods', 'GET, POST, DELETE, OPTIONS');
  h.set('access-control-expose-headers', 'x-ratelimit-remaining, mcp-session-id');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

export function randomId(prefix = '', bytes = 16): string {
  const b = new Uint8Array(bytes); crypto.getRandomValues(b);
  return prefix + [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export function clientIp(req: Request): string {
  return req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? '0.0.0.0';
}

export async function readJson<T>(req: Request): Promise<T> {
  try { return (await req.json()) as T; } catch { throw new HttpError(400, 'Invalid JSON body'); }
}

export function getCookie(req: Request, name: string): string | null {
  const m = (req.headers.get('cookie') ?? '').match(new RegExp(`(?:^|; )${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

export async function getCursor(env: Env, name: string): Promise<string | null> {
  const r = await env.DB.prepare('SELECT value FROM cursors WHERE name = ?').bind(name).first<{ value: string }>();
  return r?.value ?? null;
}
export async function setCursor(env: Env, name: string, value: string) {
  await env.DB.prepare('INSERT INTO cursors (name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value').bind(name, value).run();
}
