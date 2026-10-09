import { RECEIVING, USDC } from './config';
import { toUnits } from './pricing';

/** Solana Pay transfer request URL (spec: https://docs.solanapay.com/spec). */
export function solanaPayUrl(opts: { amount: string; reference: string; label?: string; message?: string; memo?: string; recipient?: string }): string {
  const params = new URLSearchParams();
  params.set('amount', opts.amount);
  params.set('spl-token', USDC.solana.mint);
  params.set('reference', opts.reference);
  if (opts.label) params.set('label', opts.label);
  if (opts.message) params.set('message', opts.message);
  if (opts.memo) params.set('memo', opts.memo);
  return `solana:${opts.recipient ?? RECEIVING.solana}?${params.toString().replace(/\+/g, '%20')}`;
}

/** EIP-681 ERC-20 transfer request for USDC on Ethereum mainnet. */
export function eip681UsdcUrl(units: bigint, recipient: string = RECEIVING.ethereum): string {
  return `ethereum:${USDC.ethereum.address}@${USDC.ethereum.chainId}/transfer?address=${recipient}&uint256=${units.toString()}`;
}

export { toUnits };
