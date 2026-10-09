/**
 * Data fetchers for free public APIs. Works in browsers (CORS verified for
 * DexScreener and GoPlus) and in Cloudflare Workers.
 */
import { CHAINS, chainFromDex, type ChainInfo, type ChainKey } from './config';

export const DEXSCREENER = 'https://api.dexscreener.com';
export const GOPLUS = 'https://api.gopluslabs.io/api/v1';

export interface DexPair {
  chainId: string; dexId: string; url: string; pairAddress: string; labels?: string[];
  baseToken: { address: string; name: string; symbol: string };
  quoteToken: { address: string; name: string; symbol: string };
  priceNative?: string; priceUsd?: string;
  txns?: Record<string, { buys: number; sells: number }>;
  volume?: Record<string, number>;
  priceChange?: Record<string, number>;
  liquidity?: { usd?: number; base?: number; quote?: number };
  fdv?: number; marketCap?: number; pairCreatedAt?: number;
  info?: { imageUrl?: string; websites?: { url: string; label?: string }[]; socials?: { url: string; type: string }[] };
}

export type GoPlusEvm = Record<string, any>;
export type GoPlusSolana = Record<string, any>;

async function getJson<T>(url: string, fetcher: typeof fetch = fetch, timeoutMs = 12_000, retries = 2): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetcher(url, { signal: ctrl.signal, headers: { accept: 'application/json' } });
      if ((res.status === 429 || res.status >= 500) && attempt < retries) { await sleep(500 * (attempt + 1) + Math.random() * 400); continue; }
      if (!res.ok) throw new Error(`${new URL(url).host} returned ${res.status}`);
      const body = (await res.json()) as T & { code?: number };
      // GoPlus signals rate limits in the body (code 4029) with HTTP 200.
      if (body && (body as any).code === 4029 && attempt < retries) { await sleep(700 * (attempt + 1) + Math.random() * 500); continue; }
      return body;
    } finally { clearTimeout(t); }
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** All DEX pairs for a token on a chain, sorted by liquidity desc. */
export async function fetchPairs(chain: ChainInfo, address: string, f?: typeof fetch): Promise<DexPair[]> {
  const pairs = await getJson<DexPair[] | null>(`${DEXSCREENER}/token-pairs/v1/${chain.dex}/${address}`, f);
  // Put pairs where the token is the base asset first (price is quoted for the base token).
  const a = address.toLowerCase();
  const list = (pairs ?? []).filter((p) => p.chainId === chain.dex);
  return [...sortPairs(list.filter((p) => p.baseToken.address.toLowerCase() === a)), ...sortPairs(list.filter((p) => p.baseToken.address.toLowerCase() !== a))];
}

/** Batch: up to 30 addresses on one chain. */
export async function fetchPairsBatch(chain: ChainInfo, addresses: string[], f?: typeof fetch): Promise<DexPair[]> {
  if (!addresses.length) return [];
  const pairs = await getJson<DexPair[] | null>(`${DEXSCREENER}/tokens/v1/${chain.dex}/${addresses.slice(0, 30).join(',')}`, f);
  return sortPairs(pairs ?? []);
}

export function sortPairs(p: DexPair[]): DexPair[] {
  return [...p].sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
}

export interface SearchHit { chain: ChainInfo; address: string; name: string; symbol: string; liquidityUsd: number; priceUsd?: string; imageUrl?: string; pairCreatedAt?: number }

/** Free-text search (name/symbol/address). Returns one hit per token on supported chains. */
export async function searchTokens(q: string, f?: typeof fetch): Promise<SearchHit[]> {
  const res = await getJson<{ pairs: DexPair[] | null }>(`${DEXSCREENER}/latest/dex/search?q=${encodeURIComponent(q)}`, f);
  const seen = new Map<string, SearchHit>();
  for (const p of sortPairs(res.pairs ?? [])) {
    const chain = chainFromDex(p.chainId); if (!chain) continue;
    const key = `${chain.key}:${p.baseToken.address.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.set(key, { chain, address: p.baseToken.address, name: p.baseToken.name, symbol: p.baseToken.symbol, liquidityUsd: p.liquidity?.usd ?? 0, priceUsd: p.priceUsd, imageUrl: p.info?.imageUrl, pairCreatedAt: p.pairCreatedAt });
  }
  return [...seen.values()].slice(0, 20);
}

export async function fetchGoPlus(chain: ChainInfo, address: string, f?: typeof fetch): Promise<GoPlusEvm | GoPlusSolana | null> {
  const url = chain.kind === 'solana'
    ? `${GOPLUS}/solana/token_security?contract_addresses=${address}`
    : `${GOPLUS}/token_security/${chain.goplus}?contract_addresses=${address}`;
  const res = await getJson<{ code: number; message: string; result: Record<string, any> | null }>(url, f);
  // code 1 = OK. Other codes (e.g. rate limits) are errors, not "token unknown".
  if (res.code !== 1) throw new Error(`GoPlus error ${res.code}: ${res.message}`);
  if (!res.result) return null;
  const key = Object.keys(res.result).find((k) => k.toLowerCase() === address.toLowerCase());
  return key ? res.result[key] : null;
}

export interface LaunchItem { chain: ChainInfo; address: string; description?: string; icon?: string; url: string; links?: { url: string; label?: string; type?: string }[]; pair?: DexPair }

/** Newest token profiles from DexScreener, enriched with pair data, on supported chains. */
export async function fetchLaunches(f?: typeof fetch, limit = 30): Promise<LaunchItem[]> {
  const profiles = await getJson<any[]>(`${DEXSCREENER}/token-profiles/latest/v1`, f);
  const items: LaunchItem[] = [];
  for (const p of profiles ?? []) {
    const chain = chainFromDex(p.chainId); if (!chain) continue;
    if (items.some((i) => i.chain.key === chain.key && i.address === p.tokenAddress)) continue;
    items.push({ chain, address: p.tokenAddress, description: p.description, icon: p.icon, url: p.url, links: p.links });
    if (items.length >= limit) break;
  }
  const byChain = new Map<ChainKey, LaunchItem[]>();
  for (const i of items) byChain.set(i.chain.key, [...(byChain.get(i.chain.key) ?? []), i]);
  await Promise.all([...byChain.entries()].map(async ([key, list]) => {
    try {
      const pairs = await fetchPairsBatch(CHAINS[key], list.map((l) => l.address), f);
      for (const l of list) l.pair = pairs.find((p) => p.baseToken.address.toLowerCase() === l.address.toLowerCase());
    } catch { /* pair enrichment is best-effort */ }
  }));
  return items;
}
