import type { Env } from './env';
import { CHAINS, detectAddressKind, type ChainKey } from '../../shared/config';
import { scanToken, type RiskReport } from '../../shared/risk';
import { fetchLaunches, fetchPairs } from '../../shared/data';
import { HttpError } from './util';

const TTL = 60; // seconds

export function parseToken(chainRaw: unknown, addressRaw: unknown): { chain: ChainKey; address: string } {
  const address = String(addressRaw ?? '').trim();
  const kind = detectAddressKind(address);
  if (!kind) throw new HttpError(400, 'Invalid token address');
  const chain = (String(chainRaw ?? '') || (kind === 'solana' ? 'solana' : 'ethereum')) as ChainKey;
  if (!CHAINS[chain]) throw new HttpError(400, `Unsupported chain. Use one of: ${Object.keys(CHAINS).join(', ')}`);
  if (CHAINS[chain].kind !== kind) throw new HttpError(400, `Address format doesn't match chain ${chain}`);
  return { chain, address };
}

/** Scan with a short KV cache to protect upstream free APIs. */
export async function cachedScan(env: Env, chain: ChainKey, address: string): Promise<RiskReport> {
  const key = `scan:${chain}:${chain === 'solana' ? address : address.toLowerCase()}`;
  const hit = await env.CACHE.get<RiskReport>(key, 'json');
  if (hit) return hit;
  const r = await scanToken(CHAINS[chain], address);
  if (r.dataAvailable.market && r.dataAvailable.security) await env.CACHE.put(key, JSON.stringify(r), { expirationTtl: TTL });
  return r;
}

export async function tokenInfo(env: Env, chain: ChainKey, address: string) {
  const key = `info:${chain}:${address}`;
  const hit = await env.CACHE.get(key, 'json'); if (hit) return hit;
  const pairs = await fetchPairs(CHAINS[chain], address);
  const base = pairs.find((p) => p.baseToken.address.toLowerCase() === address.toLowerCase());
  const info = {
    chain, address, name: base?.baseToken.name ?? null, symbol: base?.baseToken.symbol ?? null,
    priceUsd: base?.priceUsd ? Number(base.priceUsd) : null, fdv: base?.fdv ?? null, marketCap: base?.marketCap ?? null,
    liquidityUsd: pairs.reduce((s, p) => s + (p.liquidity?.usd ?? 0), 0), volume24h: pairs.reduce((s, p) => s + (p.volume?.h24 ?? 0), 0),
    priceChange24h: base?.priceChange?.h24 ?? null, pairCount: pairs.length,
    pairs: pairs.slice(0, 5).map((p) => ({ dex: p.dexId, pair: p.pairAddress, url: p.url, liquidityUsd: p.liquidity?.usd ?? null, createdAt: p.pairCreatedAt ?? null })),
    links: base?.info ?? null,
  };
  await env.CACHE.put(key, JSON.stringify(info), { expirationTtl: TTL });
  return info;
}

export async function compare(env: Env, tokens: { chain: ChainKey; address: string }[]) {
  if (tokens.length < 2 || tokens.length > 5) throw new HttpError(400, 'Compare 2 to 5 tokens');
  const res = await Promise.allSettled(tokens.map((t) => cachedScan(env, t.chain, t.address)));
  return res.map((r, i) => (r.status === 'fulfilled' ? r.value : { chain: tokens[i].chain, address: tokens[i].address, error: String(r.reason) }));
}

export async function launches(env: Env, chain?: string) {
  let items = await env.CACHE.get<any[]>('launches', 'json');
  if (!items) {
    items = (await fetchLaunches(undefined, 40)).map((l) => ({
      chain: l.chain.key, address: l.address, description: l.description ?? null, url: l.url,
      symbol: l.pair?.baseToken.symbol ?? null, name: l.pair?.baseToken.name ?? null,
      liquidityUsd: l.pair?.liquidity?.usd ?? null, pairCreatedAt: l.pair?.pairCreatedAt ?? null, dex: l.pair?.dexId ?? null,
    }));
    await env.CACHE.put('launches', JSON.stringify(items), { expirationTtl: 60 });
  }
  return chain ? items.filter((i) => i.chain === chain) : items;
}
