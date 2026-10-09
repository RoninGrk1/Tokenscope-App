/**
 * Shared Tokenscope configuration. Used by the static site and the Worker.
 *
 * PAYMENT ADDRESSES: these are PUBLIC receiving addresses only. The Worker reads
 * them from env vars (ETH_RECEIVING_ADDRESS / SOL_RECEIVING_ADDRESS) and refuses to
 * run checkout if they differ from the values below. `npm test` checks every
 * character against the build spec. A typo is unrecoverable, so do not edit these
 * by hand without re-running the checks.
 */

export const RECEIVING = {
  ethereum: '0xeeb8269Df3767b4889414161F89B7a63Cdf2B50c',
  solana: '2Hn8PPimz48DmbHj8Ap6QsUFT2CXzwq6fQxWH9zJHve7',
} as const;

/** Circle's official USDC contract (Ethereum) and mint (Solana). */
export const USDC = {
  ethereum: { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6, chainId: 1 },
  solana: { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6 },
} as const;

export type ChainKey = 'ethereum' | 'solana' | 'bsc' | 'base' | 'arbitrum' | 'polygon';

export interface ChainInfo {
  key: ChainKey;
  name: string;
  short: string;
  /** DexScreener chainId */
  dex: string;
  /** GoPlus chain id ('solana' uses the dedicated Solana endpoint) */
  goplus: string;
  kind: 'evm' | 'solana';
  explorer: string;
}

export const CHAINS: Record<ChainKey, ChainInfo> = {
  ethereum: { key: 'ethereum', name: 'Ethereum', short: 'ETH', dex: 'ethereum', goplus: '1', kind: 'evm', explorer: 'https://etherscan.io/token/' },
  solana: { key: 'solana', name: 'Solana', short: 'SOL', dex: 'solana', goplus: 'solana', kind: 'solana', explorer: 'https://solscan.io/token/' },
  base: { key: 'base', name: 'Base', short: 'BASE', dex: 'base', goplus: '8453', kind: 'evm', explorer: 'https://basescan.org/token/' },
  bsc: { key: 'bsc', name: 'BNB Chain', short: 'BSC', dex: 'bsc', goplus: '56', kind: 'evm', explorer: 'https://bscscan.com/token/' },
  arbitrum: { key: 'arbitrum', name: 'Arbitrum', short: 'ARB', dex: 'arbitrum', goplus: '42161', kind: 'evm', explorer: 'https://arbiscan.io/token/' },
  polygon: { key: 'polygon', name: 'Polygon', short: 'POL', dex: 'polygon', goplus: '137', kind: 'evm', explorer: 'https://polygonscan.com/token/' },
};

export const CHAIN_LIST: ChainInfo[] = Object.values(CHAINS);

export function chainFromDex(dexId: string): ChainInfo | undefined {
  return CHAIN_LIST.find((c) => c.dex === dexId);
}

export const DISCLAIMER =
  'Scores are automated signals, not financial advice and not an audit. Always do your own research.';

export const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
export const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function detectAddressKind(input: string): 'evm' | 'solana' | null {
  const s = input.trim();
  if (EVM_ADDRESS_RE.test(s)) return 'evm';
  if (SOLANA_ADDRESS_RE.test(s)) return 'solana';
  return null;
}
