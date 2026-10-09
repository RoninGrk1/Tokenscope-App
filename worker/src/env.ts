import { RECEIVING } from '../../shared/config';

export interface Env {
  DB: D1Database;
  CACHE: KVNamespace;
  APP_URL: string;
  API_URL: string;
  ALLOWED_ORIGINS: string;
  ETH_RECEIVING_ADDRESS: string;
  SOL_RECEIVING_ADDRESS: string;
  ETH_RPC_URL: string;
  SOLANA_RPC_URL: string;
  ETH_CONFIRMATIONS: string;
  PAYMENT_GRACE_MINUTES: string;
  EMAIL_FROM: string;
  RESEND_API_KEY?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  ADMIN_TOKEN?: string;
  GOPLUS_APP_KEY?: string;
  /** Optional secret RPC URLs (e.g. Helius / Alchemy with API key). Take precedence over the public vars. */
  SOLANA_RPC_PRIVATE_URL?: string;
  ETH_RPC_PRIVATE_URL?: string;
  GOPLUS_APP_SECRET?: string;
}

/**
 * Receiving addresses come from env vars but must equal the audited constants in
 * shared/config.ts (which CI checks against the spec). Any mismatch disables checkout.
 */
export function receivingAddressesOk(env: Env): boolean {
  return env.ETH_RECEIVING_ADDRESS === RECEIVING.ethereum && env.SOL_RECEIVING_ADDRESS === RECEIVING.solana;
}

export const solRpc = (env: Env) => env.SOLANA_RPC_PRIVATE_URL || env.SOLANA_RPC_URL;
export const ethRpc = (env: Env) => env.ETH_RPC_PRIVATE_URL || env.ETH_RPC_URL;
