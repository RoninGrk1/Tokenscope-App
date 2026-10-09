import type { Env } from './env';

/**
 * Optional GoPlus authenticated access. Cloudflare's shared egress IPs hit GoPlus's anonymous
 * rate limit (code 4029), so with GOPLUS_APP_KEY + GOPLUS_APP_SECRET set we fetch an access
 * token (cached in KV) and send it on every GoPlus request.
 */
async function sha1Hex(s: string) {
  const d = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

async function goplusToken(env: Env): Promise<string | null> {
  if (!env.GOPLUS_APP_KEY || !env.GOPLUS_APP_SECRET) return null;
  const cached = await env.CACHE.get('goplus:token'); if (cached) return cached;
  const time = Math.floor(Date.now() / 1000);
  const sign = await sha1Hex(env.GOPLUS_APP_KEY + time + env.GOPLUS_APP_SECRET);
  const res = await fetch('https://api.gopluslabs.io/api/v1/token', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ app_key: env.GOPLUS_APP_KEY, sign, time }) });
  const body = (await res.json()) as { code: number; message: string; result?: { access_token: string; expires_in: number } };
  if (body.code !== 1 || !body.result) { console.error('goplus token error', body.code, body.message); return null; }
  await env.CACHE.put('goplus:token', body.result.access_token, { expirationTtl: Math.max(60, Math.min(body.result.expires_in - 300, 86_400)) });
  return body.result.access_token;
}

/** fetch() wrapper that authenticates GoPlus calls when credentials are configured. */
export function upstreamFetch(env: Env): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith('https://api.gopluslabs.io/')) {
      const tok = await goplusToken(env);
      if (tok) { const h = new Headers(init?.headers); h.set('Authorization', tok); return fetch(input, { ...init, headers: h }); }
    }
    return fetch(input, init);
  }) as typeof fetch;
}
