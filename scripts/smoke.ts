import { CHAINS } from '../shared/config';
import { scanToken } from '../shared/risk';
const cases: [keyof typeof CHAINS, string][] = [
  ['ethereum', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'],
  ['ethereum', '0x6982508145454Ce325dDbE47a25d4ec3d2311933'],
  ['solana', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'],
  ['solana', 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'],
  ...(process.argv.slice(2).map((a) => a.split(':') as [keyof typeof CHAINS, string])),
];
for (const [c, a] of cases) {
  const r = await scanToken(CHAINS[c], a);
  console.log(`\n${r.chainName} ${r.symbol} (${r.name}) score=${r.score} level=${r.level} :: ${r.verdict}`);
  for (const f of r.findings) console.log(`  [${f.severity}] ${f.title} — ${f.detail}`);
}
