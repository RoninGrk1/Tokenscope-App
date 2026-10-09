/**
 * Tokenscope risk scoring engine (shared by the website and the Worker).
 *
 * Wording rule: findings describe observable, evidence-backed signals
 * ("high risk", "honeypot pattern detected by simulation"). The engine never
 * labels a token a scam as a statement of fact.
 */
import type { ChainInfo } from './config';
import { fetchGoPlus, fetchPairs, type DexPair, type GoPlusEvm, type GoPlusSolana } from './data';

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info' | 'good';
export type RiskLevel = 'low' | 'moderate' | 'high' | 'unknown';
export type Source = 'GoPlus' | 'DexScreener' | 'Tokenscope';

export interface Finding { id: string; severity: Severity; title: string; detail: string; source: Source }

export interface MarketSummary {
  priceUsd: number | null; liquidityUsd: number; volume24h: number; fdv: number | null; marketCap: number | null;
  pairCount: number; topPairUrl: string | null; topDex: string | null; pairCreatedAt: number | null; ageHours: number | null;
  buys24h: number; sells24h: number; priceChange24h: number | null; imageUrl: string | null;
}

export interface RiskReport {
  version: 1;
  chain: string; chainName: string; address: string;
  name: string; symbol: string;
  score: number; // 0 (lowest risk) .. 100 (highest risk)
  level: RiskLevel;
  verdict: string;
  findings: Finding[];
  market: MarketSummary;
  holders: { count: number | null; top10Pct: number | null };
  trusted: boolean;
  dataAvailable: { security: boolean; market: boolean };
  generatedAt: string;
}

const WEIGHT: Record<Severity, number> = { critical: 45, high: 22, medium: 10, low: 4, info: 0, good: -4 };
const DEAD = /^(0x0{40}|0x0{36}dead|0x000000000000000000000000000000000000dead|0xdead0{36})$/i;

const on = (v: unknown) => v === '1' || v === 1 || v === true;
const num = (v: unknown): number | null => { const n = typeof v === 'number' ? v : parseFloat(String(v ?? '')); return Number.isFinite(n) ? n : null; };
const pct = (f: number) => `${(f * 100).toFixed(f < 0.01 ? 2 : 1)}%`;
export const fmtUsd = (n: number | null | undefined): string => {
  if (n == null || !Number.isFinite(n)) return '\u2014';
  const a = Math.abs(n);
  if (a >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  if (a >= 1) return `$${n.toFixed(2)}`;
  if (a === 0) return '$0';
  return `$${n.toPrecision(3)}`;
};

function summarizeMarket(pairs: DexPair[], address: string): MarketSummary {
  const top = pairs.find((p) => p.baseToken.address.toLowerCase() === address.toLowerCase()) ?? pairs[0];
  const liquidityUsd = pairs.reduce((s, p) => s + (p.liquidity?.usd ?? 0), 0);
  const volume24h = pairs.reduce((s, p) => s + (p.volume?.h24 ?? 0), 0);
  const buys24h = pairs.reduce((s, p) => s + (p.txns?.h24?.buys ?? 0), 0);
  const sells24h = pairs.reduce((s, p) => s + (p.txns?.h24?.sells ?? 0), 0);
  const created = pairs.map((p) => p.pairCreatedAt).filter((x): x is number => typeof x === 'number' && x > 0);
  const pairCreatedAt = created.length ? Math.min(...created) : null;
  return {
    priceUsd: top ? num(top.priceUsd) : null, liquidityUsd, volume24h,
    fdv: top?.fdv ?? null, marketCap: top?.marketCap ?? null, pairCount: pairs.length,
    topPairUrl: top?.url ?? null, topDex: top?.dexId ?? null, pairCreatedAt,
    ageHours: pairCreatedAt ? (Date.now() - pairCreatedAt) / 3_600_000 : null,
    buys24h, sells24h, priceChange24h: top?.priceChange?.h24 ?? null, imageUrl: top?.info?.imageUrl ?? null,
  };
}

function evmFindings(g: GoPlusEvm, trusted: boolean, add: (f: Finding) => void) {
  const G = 'GoPlus' as const;
  const owner = String(g.owner_address ?? '');
  const renounced = !owner || DEAD.test(owner);
  // Centralised controls are expected (and disclosed) for trusted issuers like Circle; for
  // renounced contracts, owner-only switches can no longer be used.
  const ctrl = (sev: Severity): Severity => (trusted ? 'info' : renounced ? 'low' : sev);
  const ctrlNote = trusted ? ' Listed as a trusted token by GoPlus, so issuer controls are expected.' : renounced ? ' Ownership appears renounced, which limits this.' : '';

  if (on(g.is_honeypot)) add({ id: 'honeypot', severity: 'critical', title: 'Honeypot pattern detected', detail: 'A sell simulation failed, so holders may be unable to sell.', source: G });
  if (on(g.cannot_sell_all)) add({ id: 'cannot_sell_all', severity: 'high', title: 'Cannot sell full balance', detail: 'The contract prevents selling 100% of a holding in one transaction.', source: G });
  if (on(g.cannot_buy)) add({ id: 'cannot_buy', severity: 'medium', title: 'Buying is restricted', detail: 'The token cannot be bought directly from DEX pools.', source: G });
  if (on(g.honeypot_with_same_creator)) add({ id: 'creator_honeypots', severity: 'high', title: 'Creator linked to honeypots', detail: 'The deployer address has created tokens previously flagged as honeypots.', source: G });

  for (const [k, label] of [['buy_tax', 'Buy'], ['sell_tax', 'Sell']] as const) {
    const t = num(g[k]);
    if (t == null) continue;
    if (t >= 0.3) add({ id: k, severity: 'high', title: `${label} tax ${pct(t)}`, detail: `Every ${label.toLowerCase()} loses ${pct(t)} to the contract.`, source: G });
    else if (t >= 0.1) add({ id: k, severity: 'medium', title: `${label} tax ${pct(t)}`, detail: `A ${label.toLowerCase()} tax above 10% is unusual.`, source: G });
    else if (t > 0.0) add({ id: k, severity: 'low', title: `${label} tax ${pct(t)}`, detail: 'Small transfer tax.', source: G });
  }

  if (g.is_open_source === '0') add({ id: 'closed_source', severity: 'high', title: 'Contract source not verified', detail: 'The code is not published on the block explorer, so its behaviour cannot be reviewed.', source: G });
  if (on(g.hidden_owner)) add({ id: 'hidden_owner', severity: 'high', title: 'Hidden owner', detail: 'The contract keeps owner-level control while appearing ownerless.', source: G });
  if (on(g.can_take_back_ownership)) add({ id: 'take_back_ownership', severity: 'high', title: 'Ownership can be reclaimed', detail: 'Renounced ownership can be taken back.', source: G });
  if (on(g.owner_change_balance)) add({ id: 'owner_change_balance', severity: ctrl('high'), title: 'Owner can change balances', detail: 'The owner can modify holder balances.' + ctrlNote, source: G });
  if (on(g.selfdestruct)) add({ id: 'selfdestruct', severity: 'high', title: 'Self-destruct function', detail: 'The contract can be destroyed.', source: G });
  if (on(g.is_mintable)) add({ id: 'mintable', severity: ctrl('medium'), title: 'Supply can be minted', detail: 'New tokens can be created, diluting holders.' + ctrlNote, source: G });
  if (on(g.transfer_pausable)) add({ id: 'pausable', severity: ctrl('medium'), title: 'Transfers can be paused', detail: 'Trading can be halted by a privileged account.' + ctrlNote, source: G });
  if (on(g.is_blacklisted)) add({ id: 'blacklist', severity: ctrl('medium'), title: 'Blacklist function', detail: 'Specific addresses can be blocked from trading.' + ctrlNote, source: G });
  if (on(g.slippage_modifiable)) add({ id: 'tax_modifiable', severity: ctrl('high'), title: 'Tax can be changed', detail: 'Buy/sell tax can be raised after you buy.' + ctrlNote, source: G });
  if (on(g.personal_slippage_modifiable)) add({ id: 'personal_tax', severity: ctrl('high'), title: 'Per-address tax', detail: 'Specific wallets can be given a different tax.' + ctrlNote, source: G });
  if (on(g.trading_cooldown)) add({ id: 'cooldown', severity: ctrl('low'), title: 'Trading cooldown', detail: 'Consecutive trades are rate-limited.', source: G });
  if (on(g.external_call)) add({ id: 'external_call', severity: ctrl('medium'), title: 'External calls in transfers', detail: 'Transfers call other contracts, which can change behaviour.' + ctrlNote, source: G });
  if (on(g.is_proxy)) add({ id: 'proxy', severity: ctrl('medium'), title: 'Upgradeable proxy', detail: 'The contract logic can be replaced.' + ctrlNote, source: G });
  if (on(g.is_whitelisted) && !trusted) add({ id: 'whitelist', severity: 'low', title: 'Whitelist function', detail: 'Some addresses get special trading rules.', source: G });

  if (renounced && !trusted) add({ id: 'renounced', severity: 'good', title: 'Ownership renounced', detail: 'Owner address is the zero/dead address.', source: G });
  if (g.is_open_source === '1' && !trusted) add({ id: 'verified', severity: 'good', title: 'Verified source code', detail: 'Contract code is public on the explorer.', source: G });

  const creatorPct = num(g.creator_percent);
  if (creatorPct != null && creatorPct >= 0.05 && !trusted) add({ id: 'creator_holds', severity: creatorPct >= 0.2 ? 'high' : 'medium', title: `Creator holds ${pct(creatorPct)}`, detail: 'The deployer still holds a large share of supply.', source: G });

  // LP: share held by plain wallets and not locked.
  const lp: any[] = Array.isArray(g.lp_holders) ? g.lp_holders : [];
  if (lp.length && !trusted) {
    const unlockedEoa = lp.filter((h) => !on(h.is_locked) && !on(h.is_contract) && !DEAD.test(String(h.address ?? ''))).reduce((s, h) => s + (num(h.percent) ?? 0), 0);
    if (unlockedEoa >= 0.5) add({ id: 'lp_unlocked', severity: 'medium', title: `${pct(unlockedEoa)} of LP unlocked in wallets`, detail: 'Liquidity could be withdrawn quickly by those wallets.', source: G });
  }
}

function solanaFindings(g: GoPlusSolana, trusted: boolean, add: (f: Finding) => void) {
  const G = 'GoPlus' as const;
  const st = (o: any) => on(o?.status);
  const ctrl = (sev: Severity): Severity => (trusted ? 'info' : sev);
  const note = trusted ? ' Listed as a trusted token by GoPlus, so issuer controls are expected.' : '';
  const authorities = ['mintable', 'freezable', 'closable', 'balance_mutable_authority', 'metadata_mutable', 'transfer_fee_upgradable', 'transfer_hook_upgradable', 'default_account_state_upgradable']
    .flatMap((k) => (g[k]?.authority ?? g[k]?.metadata_upgrade_authority ?? []) as any[]);
  if (authorities.some((a) => on(a?.malicious_address))) add({ id: 'malicious_authority', severity: 'critical', title: 'Authority flagged as malicious', detail: 'A mint/freeze/update authority is on a malicious-address list.', source: G });

  if (on(g.non_transferable)) add({ id: 'non_transferable', severity: 'critical', title: 'Non-transferable token', detail: 'Holders cannot transfer or sell this token.', source: G });
  if (st(g.balance_mutable_authority)) add({ id: 'balance_mutable', severity: ctrl('critical'), title: 'Balances can be changed', detail: 'An authority can modify holder balances.' + note, source: G });
  if (st(g.mintable)) add({ id: 'mintable', severity: ctrl('high'), title: 'Mint authority active', detail: 'New supply can be minted at any time.' + note, source: G });
  else add({ id: 'mint_revoked', severity: trusted ? 'info' : 'good', title: 'Mint authority revoked', detail: 'Supply is fixed.', source: G });
  if (st(g.freezable)) add({ id: 'freezable', severity: ctrl('high'), title: 'Freeze authority active', detail: 'Token accounts can be frozen, blocking sells.' + note, source: G });
  else add({ id: 'freeze_revoked', severity: trusted ? 'info' : 'good', title: 'Freeze authority revoked', detail: 'Accounts cannot be frozen.', source: G });
  if (st(g.closable)) add({ id: 'closable', severity: ctrl('high'), title: 'Mint can be closed', detail: 'The token mint can be closed by an authority.' + note, source: G });
  if (g.default_account_state === '2') add({ id: 'default_frozen', severity: ctrl('high'), title: 'New accounts start frozen', detail: 'Buyers\u2019 token accounts are frozen by default.' + note, source: G });
  const fee = g.transfer_fee && typeof g.transfer_fee === 'object' ? g.transfer_fee : {};
  if (Object.keys(fee).length) {
    // GoPlus reports fee_rate as a fraction (0.01 = 1%).
    const rate = num(fee.current_fee_rate?.fee_rate ?? fee.fee_rate);
    if (rate == null || rate > 0) add({ id: 'transfer_fee', severity: rate != null && rate >= 0.1 ? 'high' : rate != null && rate < 0.02 ? 'low' : 'medium', title: rate != null ? `Transfer fee ${pct(rate)}` : 'Transfer fee configured', detail: 'A Token-2022 transfer fee is taken on every transfer.', source: G });
  }
  if (st(g.transfer_fee_upgradable)) add({ id: 'fee_upgradable', severity: ctrl('medium'), title: 'Transfer fee can be changed', detail: 'An authority can raise the transfer fee.' + note, source: G });
  if (Array.isArray(g.transfer_hook) && g.transfer_hook.length) add({ id: 'transfer_hook', severity: ctrl('high'), title: 'Transfer hook program', detail: 'A custom program runs on every transfer and could block sells.' + note, source: G });
  if (st(g.transfer_hook_upgradable)) add({ id: 'hook_upgradable', severity: ctrl('medium'), title: 'Transfer hook can be changed', detail: 'An authority can add or change a transfer hook.' + note, source: G });
  if (st(g.metadata_mutable)) add({ id: 'metadata_mutable', severity: trusted ? 'info' : 'low', title: 'Metadata is mutable', detail: 'Name, symbol or image can be changed.', source: G });
}

function holderFindings(g: any, trusted: boolean, kind: 'evm' | 'solana', add: (f: Finding) => void): number | null {
  const holders: any[] = Array.isArray(g?.holders) ? g.holders : [];
  if (!holders.length) return null;
  const top10 = holders.slice(0, 10).reduce((s, h) => s + (num(h.percent) ?? 0), 0);
  if (trusted) return top10;
  const wallets = holders.filter((h) => !on(h.is_locked) && !(kind === 'evm' && on(h.is_contract)) && !DEAD.test(String(h.address ?? h.account ?? '')) && !(h.tag && String(h.tag).length));
  const biggest = Math.max(0, ...wallets.map((h) => num(h.percent) ?? 0));
  const walletSum = wallets.slice(0, 10).reduce((s, h) => s + (num(h.percent) ?? 0), 0);
  if (biggest >= 0.2) add({ id: 'whale', severity: 'high', title: `One wallet holds ${pct(biggest)}`, detail: 'A single unlocked wallet controls a large share of supply.', source: 'GoPlus' });
  else if (biggest >= 0.1) add({ id: 'whale', severity: 'medium', title: `Largest wallet holds ${pct(biggest)}`, detail: 'Concentrated supply can move price sharply.', source: 'GoPlus' });
  if (walletSum >= 0.5) add({ id: 'concentration', severity: 'high', title: `Top wallets hold ${pct(walletSum)}`, detail: 'Unlocked, untagged wallets in the top 10 hold most of the supply (excludes contracts, pools, burn and locked).', source: 'GoPlus' });
  else if (walletSum >= 0.3) add({ id: 'concentration', severity: 'medium', title: `Top wallets hold ${pct(walletSum)}`, detail: 'Supply is fairly concentrated among a few wallets.', source: 'GoPlus' });
  return top10;
}

function marketFindings(m: MarketSummary, trusted: boolean, add: (f: Finding) => void) {
  const D = 'DexScreener' as const;
  if (m.pairCount === 0) { add({ id: 'no_pairs', severity: 'high', title: 'No DEX liquidity found', detail: 'DexScreener lists no trading pairs for this token on this chain, so it may be impossible to sell.', source: D }); return; }
  const L = m.liquidityUsd;
  const bonding = m.topDex === 'pumpfun' || m.topDex === 'moonshot' || m.topDex === 'launchlab';
  if (L === 0 && bonding) add({ id: 'liquidity', severity: 'medium', title: `Still on a bonding curve (${m.topDex})`, detail: 'The token has not graduated to a DEX pool yet; liquidity is the launchpad curve.', source: D });
  else if (L === 0) add({ id: 'liquidity', severity: 'high', title: 'Liquidity not reported', detail: 'DexScreener reports no pool liquidity for this token.', source: D });
  else if (L < 10_000) add({ id: 'liquidity', severity: 'high', title: `Very low liquidity (${fmtUsd(L)})`, detail: 'Small pools mean large price impact and easy manipulation.', source: D });
  else if (L < 50_000) add({ id: 'liquidity', severity: 'medium', title: `Low liquidity (${fmtUsd(L)})`, detail: 'Trades of a few thousand dollars can move price a lot.', source: D });
  else if (L >= 1_000_000) add({ id: 'liquidity', severity: 'good', title: `Deep liquidity (${fmtUsd(L)})`, detail: `Across ${m.pairCount} pair${m.pairCount === 1 ? '' : 's'}.`, source: D });
  if (m.ageHours != null) {
    if (m.ageHours < 24) add({ id: 'age', severity: m.ageHours < 6 ? 'high' : 'medium', title: `Brand new (${Math.max(1, Math.round(m.ageHours))}h old)`, detail: 'Oldest pool is under 24 hours old. Most rug pulls happen early.', source: D });
    else if (m.ageHours < 24 * 7) add({ id: 'age', severity: 'low', title: `New (${Math.round(m.ageHours / 24)} days old)`, detail: 'Oldest pool is under a week old.', source: D });
  }
  if (m.buys24h >= 30 && m.sells24h === 0) add({ id: 'no_sells', severity: 'critical', title: 'Buys but zero sells in 24h', detail: `${m.buys24h} buys and no sells. This is a common honeypot pattern.`, source: D });
  else if (m.buys24h >= 50 && m.sells24h / m.buys24h < 0.1) add({ id: 'few_sells', severity: 'medium', title: 'Very few sells', detail: `${m.sells24h} sells vs ${m.buys24h} buys in 24h.`, source: D });
  if (m.priceChange24h != null && m.priceChange24h <= -80) add({ id: 'crash', severity: 'high', title: `Price down ${Math.abs(m.priceChange24h).toFixed(0)}% in 24h`, detail: 'A collapse like this often follows liquidity removal or a large dump.', source: D });
  if (!trusted && m.fdv && L > 0 && m.fdv / L > 200) add({ id: 'thin_vs_fdv', severity: 'low', title: 'Thin liquidity for its valuation', detail: `FDV ${fmtUsd(m.fdv)} vs liquidity ${fmtUsd(L)}.`, source: D });
  if (!trusted && L > 0 && m.volume24h / L > 50) add({ id: 'volume_spike', severity: 'low', title: 'Unusual volume vs liquidity', detail: `24h volume is ${(m.volume24h / L).toFixed(0)}x liquidity, which can indicate wash trading.`, source: D });
}

const ORDER: Severity[] = ['critical', 'high', 'medium', 'low', 'info', 'good'];

export function scoreToken(input: { chain: ChainInfo; address: string; security: GoPlusEvm | GoPlusSolana | null; pairs: DexPair[]; marketError?: boolean; securityError?: boolean }): RiskReport {
  const { chain, address, security: g, pairs } = input;
  const findings: Finding[] = [];
  const add = (f: Finding) => { if (!findings.some((x) => x.id === f.id)) findings.push(f); };
  const trusted = !!g && (chain.kind === 'solana' ? on(g.trusted_token) : on(g.trust_list));
  const market = summarizeMarket(pairs, address);

  if (g) {
    if (trusted) add({ id: 'trusted', severity: 'good', title: 'Trusted token', detail: 'GoPlus lists this as a well-known, trusted token.', source: 'GoPlus' });
    if (chain.kind === 'solana') solanaFindings(g, trusted, add); else evmFindings(g, trusted, add);
    if (chain.kind === 'evm' && g.is_in_cex?.listed === '1') add({ id: 'cex', severity: 'good', title: 'Listed on major exchanges', detail: (g.is_in_cex.cex_list ?? []).slice(0, 5).join(', '), source: 'GoPlus' });
  } else {
    add({ id: 'no_security', severity: 'medium', title: 'Contract security data unavailable', detail: input.securityError ? 'The security provider did not respond. Try again shortly.' : 'GoPlus has no record of this token yet, so contract checks could not run.', source: 'Tokenscope' });
  }
  const top10 = g ? holderFindings(g, trusted, chain.kind, add) : null;
  if (!input.marketError) marketFindings(market, trusted, add);
  else add({ id: 'no_market', severity: 'info', title: 'Market data unavailable', detail: 'DexScreener did not respond.', source: 'Tokenscope' });

  findings.sort((a, b) => ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity));
  // Positive signals offset at most 30% of the risk weight, so they never hide a red flag.
  const riskSum = findings.reduce((s, f) => s + Math.max(0, WEIGHT[f.severity]), 0);
  const goodSum = -findings.reduce((s, f) => s + Math.min(0, WEIGHT[f.severity]), 0);
  let score = Math.round(Math.max(0, Math.min(100, riskSum - Math.min(goodSum, riskSum * 0.3))));
  const crit = findings.filter((f) => f.severity === 'critical').length;
  const high = findings.filter((f) => f.severity === 'high').length;
  if (crit) score = Math.max(score, 85);
  let level: RiskLevel = score >= 45 || crit ? 'high' : score >= 15 ? 'moderate' : 'low';
  if (!g && pairs.length === 0) level = 'unknown';

  const name = g?.token_name || g?.metadata?.name || pairs.find((p) => p.baseToken.address.toLowerCase() === address.toLowerCase())?.baseToken.name || 'Unknown token';
  const symbol = g?.token_symbol || g?.metadata?.symbol || pairs.find((p) => p.baseToken.address.toLowerCase() === address.toLowerCase())?.baseToken.symbol || '?';
  const red = crit + high;
  const verdict = level === 'unknown' ? 'Not enough data to score this token.'
    : level === 'high' ? `High risk: ${red || 'several'} serious warning sign${red === 1 ? '' : 's'} found.`
    : level === 'moderate' ? 'Moderate risk: some warning signs worth checking.'
    : 'Low risk signals: no major red flags found.';

  return {
    version: 1, chain: chain.key, chainName: chain.name, address, name, symbol, score, level, verdict, findings, market,
    holders: { count: num(g?.holder_count), top10Pct: top10 }, trusted,
    dataAvailable: { security: !!g, market: !input.marketError },
    generatedAt: new Date().toISOString(),
  };
}

/** Fetch both sources and score. Errors in one source degrade gracefully. */
export async function scanToken(chain: ChainInfo, address: string, f?: typeof fetch): Promise<RiskReport> {
  const [sec, mkt] = await Promise.allSettled([fetchGoPlus(chain, address, f), fetchPairs(chain, address, f)]);
  if (sec.status === 'rejected') console.warn('security source failed:', String(sec.reason));
  if (mkt.status === 'rejected') console.warn('market source failed:', String(mkt.reason));
  return scoreToken({
    chain, address,
    security: sec.status === 'fulfilled' ? sec.value : null, securityError: sec.status === 'rejected',
    pairs: mkt.status === 'fulfilled' ? mkt.value : [], marketError: mkt.status === 'rejected',
  });
}
