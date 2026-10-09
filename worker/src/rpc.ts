/** JSON-RPC call with retry/backoff on 429 and 5xx (free public RPCs rate-limit shared Cloudflare IPs). */
export async function rpc<T = any>(url: string, method: string, params: unknown[], retries = 3): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    if ((res.status === 429 || res.status >= 500) && attempt < retries) { await new Promise((r) => setTimeout(r, 600 * 2 ** attempt + Math.random() * 400)); continue; }
    if (!res.ok) throw new Error(`${method}: HTTP ${res.status}`);
    const body = (await res.json()) as { result?: T; error?: { message: string; code?: number } };
    if (body.error) throw new Error(`${method}: ${body.error.message}`);
    return body.result as T;
  }
}
