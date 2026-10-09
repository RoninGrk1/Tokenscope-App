import type { Env } from './env';
import { rpc } from './rpc';
import { getCursor, now, setCursor } from './util';
import { activateInvoice, type InvoiceRow } from './activate';
import { USDC } from '../../shared/config';

export const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const pad = (addr: string) => '0x' + addr.toLowerCase().replace(/^0x/, '').padStart(64, '0');
const topicAddr = (t: string) => '0x' + t.slice(-40);
const hex = (n: number | bigint) => '0x' + n.toString(16);
const MAX_RANGE = 500;

interface Log { address: string; topics: string[]; data: string; blockNumber: string; transactionHash: string; removed?: boolean }

async function blockTime(env: Env, block: string, cache: Map<string, number>): Promise<number> {
  if (!cache.has(block)) { const b = await rpc<{ timestamp: string }>(env.ETH_RPC_URL, 'eth_getBlockByNumber', [block, false]); cache.set(block, parseInt(b.timestamp, 16) * 1000); }
  return cache.get(block)!;
}

function candidateWindow(env: Env) { return now() - Number(env.PAYMENT_GRACE_MINUTES) * 60_000; }

/**
 * Ethereum matcher (cron): scan USDC Transfer events to our address up to `latest - confirmations`,
 * and match each exact amount to an open invoice created before the transfer.
 */
export async function runEthereumMatcher(env: Env) {
  const latest = parseInt(await rpc<string>(env.ETH_RPC_URL, 'eth_blockNumber', []), 16);
  const safe = latest - Number(env.ETH_CONFIRMATIONS);
  const cur = await getCursor(env, 'eth_last_block');
  const from = cur ? Number(cur) + 1 : safe - 50;
  if (from > safe) return;
  const to = Math.min(safe, from + MAX_RANGE - 1);
  const logs = await rpc<Log[]>(env.ETH_RPC_URL, 'eth_getLogs', [{ address: USDC.ethereum.address, topics: [TRANSFER_TOPIC, null, pad(env.ETH_RECEIVING_ADDRESS)], fromBlock: hex(from), toBlock: hex(to) }]);
  const times = new Map<string, number>();
  for (const log of logs) {
    if (log.removed) continue;
    const amount = BigInt(log.data);
    const inv = await env.DB.prepare("SELECT * FROM invoices WHERE chain = 'ethereum' AND amount_units = ? AND status IN ('pending','confirming','expired') AND expires_at > ? ORDER BY created_at DESC LIMIT 1")
      .bind(amount.toString(), candidateWindow(env)).first<InvoiceRow>();
    if (!inv) { console.log(`unmatched USDC transfer ${log.transactionHash} amount=${amount}`); continue; }
    const ts = await blockTime(env, log.blockNumber, times);
    if (ts < inv.created_at - 60_000 || ts > inv.expires_at + Number(env.PAYMENT_GRACE_MINUTES) * 60_000) continue;
    await activateInvoice(env, inv, { txHash: log.transactionHash, payer: topicAddr(log.topics[1]), amountUnits: amount, blockRef: `block:${parseInt(log.blockNumber, 16)}` });
  }
  await setCursor(env, 'eth_last_block', String(to));
  // Re-check invoices where the customer pasted a tx hash that wasn't yet confirmed.
  const { results } = await env.DB.prepare("SELECT * FROM invoices WHERE chain = 'ethereum' AND status = 'confirming' AND tx_hash IS NOT NULL LIMIT 20").all<InvoiceRow>();
  for (const inv of results) { try { await verifyEthTx(env, inv, inv.tx_hash!); } catch (e) { console.error('eth tx recheck', e); } }
}

/** Speed path: the customer pastes a tx hash. Returns the resulting invoice status. */
export async function verifyEthTx(env: Env, inv: InvoiceRow, txHash: string): Promise<'paid' | 'confirming' | 'invalid'> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) return 'invalid';
  const receipt = await rpc<{ status: string; blockNumber: string; logs: Log[] } | null>(env.ETH_RPC_URL, 'eth_getTransactionReceipt', [txHash]);
  if (!receipt) { await markConfirming(env, inv, txHash); return 'confirming'; }
  if (receipt.status !== '0x1') return 'invalid';
  const log = receipt.logs.find((l) => l.address.toLowerCase() === USDC.ethereum.address.toLowerCase() && l.topics[0] === TRANSFER_TOPIC
    && l.topics[2]?.toLowerCase() === pad(env.ETH_RECEIVING_ADDRESS) && BigInt(l.data) === BigInt(inv.amount_units));
  if (!log) return 'invalid';
  const ts = await blockTime(env, receipt.blockNumber, new Map());
  if (ts < inv.created_at - 60_000) return 'invalid';
  const latest = parseInt(await rpc<string>(env.ETH_RPC_URL, 'eth_blockNumber', []), 16);
  if (latest - parseInt(receipt.blockNumber, 16) < Number(env.ETH_CONFIRMATIONS)) { await markConfirming(env, inv, txHash); return 'confirming'; }
  await activateInvoice(env, inv, { txHash, payer: topicAddr(log.topics[1]), amountUnits: BigInt(log.data), blockRef: `block:${parseInt(receipt.blockNumber, 16)}` });
  return 'paid';
}

async function markConfirming(env: Env, inv: InvoiceRow, txHash: string) {
  await env.DB.prepare("UPDATE invoices SET status = 'confirming', tx_hash = ? WHERE id = ? AND status IN ('pending','expired','confirming')").bind(txHash, inv.id).run();
}
