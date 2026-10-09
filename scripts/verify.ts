/**
 * Pre-launch safety checks (run in CI before every deploy):
 *  1. Receiving addresses + USDC addresses match docs/BUILD_SPEC.md character by character.
 *  2. Ethereum addresses have a valid EIP-55 checksum; Solana addresses decode to 32 bytes.
 *  3. Pricing table matches the spec exactly.
 *  4. Payment helpers produce correct amounts/links.
 */
import { readFileSync } from 'node:fs';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { RECEIVING, USDC } from '../shared/config';
import { PLANS, CREDIT_PACKS, ethUniqueAmount, stackExpiry, proratedUpgradePrice, DAY_MS } from '../shared/pricing';
import { base58Decode, randomReference } from '../shared/base58';
import { solanaPayUrl, eip681UsdcUrl } from '../shared/payments';

let failed = 0;
const ok = (cond: boolean, msg: string) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) failed++; };

const spec = readFileSync(new URL('../docs/BUILD_SPEC.md', import.meta.url), 'utf8');
const specEth = spec.match(/\| Ethereum \| USDC \(ERC-20\) \| `([^`]+)` \|/)?.[1];
const specSol = spec.match(/\| Solana \| USDC \(SPL\) \| `([^`]+)` \|/)?.[1];
const specUsdcEth = spec.match(/- Ethereum: `([^`]+)`/)?.[1];
const specUsdcSol = spec.match(/- Solana: `([^`]+)`/)?.[1];

function sameChars(a: string | undefined, b: string, label: string) {
  if (!a) return ok(false, `${label}: not found in spec`);
  const diff = [...b].findIndex((c, i) => a[i] !== c);
  ok(a === b && a.length === b.length, `${label}: ${b} (${b.length} chars) ${a === b ? 'matches spec exactly' : `differs at index ${diff}`}`);
}
sameChars(specEth, RECEIVING.ethereum, 'ETH receiving address');
sameChars(specSol, RECEIVING.solana, 'SOL receiving address');
sameChars(specUsdcEth, USDC.ethereum.address, 'USDC Ethereum contract');
sameChars(specUsdcSol, USDC.solana.mint, 'USDC Solana mint');

function eip55(addr: string): string {
  const lower = addr.slice(2).toLowerCase();
  const hash = Buffer.from(keccak_256(new TextEncoder().encode(lower))).toString('hex');
  return '0x' + [...lower].map((c, i) => (parseInt(hash[i], 16) >= 8 ? c.toUpperCase() : c)).join('');
}
ok(eip55(RECEIVING.ethereum) === RECEIVING.ethereum, 'ETH receiving address has valid EIP-55 checksum');
ok(eip55(USDC.ethereum.address) === USDC.ethereum.address, 'USDC contract has valid EIP-55 checksum');
ok(base58Decode(RECEIVING.solana).length === 32, 'SOL receiving address decodes to 32 bytes');
ok(base58Decode(USDC.solana.mint).length === 32, 'USDC mint decodes to 32 bytes');
ok(base58Decode(randomReference()).length === 32, 'Solana Pay reference is 32 bytes');

// Pricing vs spec table
for (const [label, id] of [['Pro', 'pro'], ['Builder \\(API \\+ MCP\\)', 'builder'], ['Alerts Team', 'alerts']] as const) {
  const m = spec.match(new RegExp(`\\| \\*\\*${label}\\*\\* \\| \\$(\\d+) \\| \\$(\\d+) \\| \\$(\\d+) \\|`));
  const p = PLANS[id].prices;
  ok(!!m && +m[1] === p[30] && +m[2] === p[90] && +m[3] === p[365], `${id} prices ${p[30]}/${p[90]}/${p[365]} match spec`);
}
for (const c of CREDIT_PACKS) ok(new RegExp(`\\| \\$${c.price} \\| ${c.calls.toLocaleString('en-US')} \\|`).test(spec), `credit pack $${c.price} = ${c.calls} calls matches spec`);

// Payment helpers
const e = ethUniqueAmount(79, 417);
ok(e.display === '79.0417' && e.units === 79_041_700n, `ETH unique amount 79 + #417 -> ${e.display} (${e.units} units)`);
ok(eip681UsdcUrl(e.units) === `ethereum:${USDC.ethereum.address}@1/transfer?address=${RECEIVING.ethereum}&uint256=79041700`, 'EIP-681 link');
const sp = solanaPayUrl({ amount: '29', reference: 'REF', label: 'Tokenscope' });
ok(sp === `solana:${RECEIVING.solana}?amount=29&spl-token=${USDC.solana.mint}&reference=REF&label=Tokenscope`, 'Solana Pay link');
const now = Date.UTC(2026, 0, 1);
ok(stackExpiry(now + 10 * DAY_MS, now, 30) === now + 40 * DAY_MS, 'renewal before expiry stacks onto end of current period');
ok(stackExpiry(now - DAY_MS, now, 30) === now + 30 * DAY_MS, 'renewal after expiry starts now');
const pr = proratedUpgradePrice({ currentPaid: 29, currentDays: 30, currentExpiresAt: now + 15 * DAY_MS, now, newPrice: 79 });
ok(pr.credit === 14.5 && pr.due === 64.5, `upgrade Pro->Builder with 15 days left: credit $${pr.credit}, due $${pr.due}`);

if (failed) { console.error(`\n${failed} check(s) FAILED`); process.exit(1); }
console.log('\nAll checks passed.');
