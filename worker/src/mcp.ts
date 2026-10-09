/**
 * tokenscope-mcp: Model Context Protocol server over Streamable HTTP (JSON responses).
 * Tools: scan_token, get_token_info, compare_tokens, new_launches, watch_address.
 */
import type { Env } from './env';
import { HttpError, json } from './util';
import { authorize } from './limits';
import { cachedScan, compare, launches, parseToken, tokenInfo } from './scanner';
import { addWatch } from './watches';
import { CHAINS, DISCLAIMER } from '../../shared/config';

const SERVER = { name: 'tokenscope-mcp', version: '0.1.0' };
const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const chainEnum = Object.keys(CHAINS);

export const TOOLS = [
  { name: 'scan_token', description: `Risk-scan a token: honeypot, taxes, owner/mint/freeze powers, liquidity, holder concentration. Returns score 0-100 (higher = riskier), level, verdict and evidence-backed findings. ${DISCLAIMER}`,
    inputSchema: { type: 'object', properties: { chain: { type: 'string', enum: chainEnum }, address: { type: 'string', description: 'Token contract / mint address' } }, required: ['address'] } },
  { name: 'get_token_info', description: 'Market info for a token: name, symbol, price, liquidity, volume, FDV, top pools.',
    inputSchema: { type: 'object', properties: { chain: { type: 'string', enum: chainEnum }, address: { type: 'string' } }, required: ['address'] } },
  { name: 'compare_tokens', description: 'Scan 2-5 tokens and return their risk reports side by side.',
    inputSchema: { type: 'object', properties: { tokens: { type: 'array', minItems: 2, maxItems: 5, items: { type: 'object', properties: { chain: { type: 'string', enum: chainEnum }, address: { type: 'string' } }, required: ['address'] } } }, required: ['tokens'] } },
  { name: 'new_launches', description: 'Newest token launches on supported chains (from DexScreener profiles) with liquidity and pool age.',
    inputSchema: { type: 'object', properties: { chain: { type: 'string', enum: chainEnum }, limit: { type: 'number', minimum: 1, maximum: 40 } } } },
  { name: 'watch_address', description: 'Watch a token and get an alert (Telegram, Discord or email) when its risk level changes. Needs a paid plan with watches.',
    inputSchema: { type: 'object', properties: { chain: { type: 'string', enum: chainEnum }, address: { type: 'string' }, channel: { type: 'string', enum: ['telegram', 'discord', 'email'] }, target: { type: 'string', description: 'Chat id, Discord webhook URL or email (optional if linked)' } }, required: ['address'] } },
] as const;

type RpcReq = { jsonrpc: '2.0'; id?: string | number | null; method: string; params?: any };
const ok = (id: RpcReq['id'], result: unknown) => ({ jsonrpc: '2.0', id: id ?? null, result });
const fail = (id: RpcReq['id'], code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

async function callTool(env: Env, req: Request, name: string, args: any) {
  const access = await authorize(env, req, name === 'watch_address' ? 'watch' : 'mcp');
  switch (name) {
    case 'scan_token': { const t = parseToken(args?.chain, args?.address); return cachedScan(env, t.chain, t.address); }
    case 'get_token_info': { const t = parseToken(args?.chain, args?.address); return tokenInfo(env, t.chain, t.address); }
    case 'compare_tokens': return compare(env, (args?.tokens ?? []).map((t: any) => parseToken(t?.chain, t?.address)));
    case 'new_launches': return (await launches(env, args?.chain)).slice(0, Math.min(40, Number(args?.limit) || 20));
    case 'watch_address': { if (!access.user) throw new HttpError(401, 'API key required'); return addWatch(env, access.user, access.sub, args ?? {}); }
    default: throw new HttpError(404, `Unknown tool ${name}`);
  }
}

async function handle(env: Env, req: Request, m: RpcReq) {
  switch (m.method) {
    case 'initialize': {
      const v = PROTOCOLS.includes(m.params?.protocolVersion) ? m.params.protocolVersion : PROTOCOLS[0];
      return ok(m.id, { protocolVersion: v, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER, instructions: `Token risk scans. ${DISCLAIMER}` });
    }
    case 'ping': return ok(m.id, {});
    case 'tools/list': return ok(m.id, { tools: TOOLS });
    case 'tools/call': {
      try {
        const data = await callTool(env, req, m.params?.name, m.params?.arguments);
        return ok(m.id, { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: Array.isArray(data) ? { items: data } : data, isError: false });
      } catch (e) {
        const msg = e instanceof HttpError ? `${e.status}: ${e.message}` : (e as Error).message;
        return ok(m.id, { content: [{ type: 'text', text: msg }], isError: true });
      }
    }
    default: return fail(m.id, -32601, `Method not found: ${m.method}`);
  }
}

export async function mcpHandler(env: Env, req: Request): Promise<Response> {
  if (req.method === 'GET') return new Response('Use POST (Streamable HTTP, JSON responses).', { status: 405, headers: { allow: 'POST' } });
  if (req.method === 'DELETE') return new Response(null, { status: 204 });
  let body: RpcReq | RpcReq[];
  try { body = await req.json(); } catch { return json(fail(null, -32700, 'Parse error'), 400); }
  const batch = Array.isArray(body) ? body : [body];
  const out = [];
  for (const m of batch) { if (m.id === undefined || m.id === null) continue; out.push(await handle(env, req, m)); } // notifications get no response
  if (!out.length) return new Response(null, { status: 202 });
  return json(Array.isArray(body) ? out : out[0]);
}
