import { CHAINS, CHAIN_LIST, detectAddressKind, type ChainKey } from '../../shared/config';
import { scanToken, fmtUsd, type RiskReport } from '../../shared/risk';
import { esc, href, layout, levelBadge, setMeta, ago } from './ui';
import { navigate } from './router';

export function compareView(root: HTMLElement, params: URLSearchParams) {
  setMeta('Compare tokens · Tokenscope');
  const items = (params.get('t') ?? '').split(',').filter(Boolean).map((s) => { const [c, a] = s.split(':'); return { chain: c as ChainKey, address: a }; }).filter((x) => CHAINS[x.chain] && x.address).slice(0, 4);
  while (items.length < 2) items.push({ chain: 'ethereum', address: '' });
  const row = (it: { chain: ChainKey; address: string }, i: number) => `<div class="row" style="flex-wrap:nowrap">
      <select class="field" style="max-width:150px" data-i="${i}" name="c">${CHAIN_LIST.map((c) => `<option value="${c.key}" ${c.key === it.chain ? 'selected' : ''}>${c.name}</option>`).join('')}</select>
      <input class="field mono" name="a" data-i="${i}" placeholder="Token address" value="${esc(it.address)}"></div>`;
  root.innerHTML = layout(`
    <h1 style="font-size:36px">Compare tokens</h1>
    <p class="muted">Side-by-side risk signals for up to 4 tokens. Compare is a Pro feature, free during the public preview.</p>
    <form id="cmpform" class="card stack">
      <div class="grid g2" id="rows">${items.map(row).join('')}</div>
      <div class="row"><button type="button" class="btn ghost sm" id="addrow">+ Add token</button><button class="btn" type="submit">Compare</button></div>
    </form>
    <div id="cmpout" class="section"></div>`, '/compare');
  const form = root.querySelector<HTMLFormElement>('#cmpform')!;
  root.querySelector('#addrow')!.addEventListener('click', () => {
    const rows = root.querySelector('#rows')!; if (rows.children.length >= 4) return;
    rows.insertAdjacentHTML('beforeend', row({ chain: 'ethereum', address: '' }, rows.children.length));
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const cs = [...form.querySelectorAll<HTMLSelectElement>('select[name=c]')];
    const as = [...form.querySelectorAll<HTMLInputElement>('input[name=a]')];
    const t = as.map((a, i) => {
      const addr = a.value.trim(); if (!addr) return '';
      let c = cs[i].value as ChainKey; const k = detectAddressKind(addr);
      if (k && CHAINS[c].kind !== k) c = k === 'solana' ? 'solana' : 'ethereum';
      return `${c}:${addr}`;
    }).filter(Boolean);
    navigate(`/compare?t=${t.join(',')}`);
  });
  const ready = items.filter((i) => i.address);
  if (ready.length >= 1) void runCompare(root.querySelector('#cmpout')!, ready);
}

async function runCompare(out: HTMLElement, items: { chain: ChainKey; address: string }[]) {
  out.innerHTML = `<div class="card"><span class="spinner"></span> Scanning ${items.length} token${items.length > 1 ? 's' : ''}…</div>`;
  const res = await Promise.allSettled(items.map((i) => scanToken(CHAINS[i.chain], i.address)));
  const reps = res.map((r) => (r.status === 'fulfilled' ? r.value : null));
  const cell = (fn: (r: RiskReport) => string) => reps.map((r) => `<td>${r ? fn(r) : '<span class="dim">failed</span>'}</td>`).join('');
  const rows: [string, (r: RiskReport) => string][] = [
    ['Risk', (r) => levelBadge(r.level, r.score)],
    ['Verdict', (r) => esc(r.verdict)],
    ['Chain', (r) => esc(r.chainName)],
    ['Price', (r) => fmtUsd(r.market.priceUsd)],
    ['Liquidity', (r) => fmtUsd(r.market.liquidityUsd)],
    ['24h volume', (r) => fmtUsd(r.market.volume24h)],
    ['FDV', (r) => fmtUsd(r.market.fdv)],
    ['Pool age', (r) => ago(r.market.pairCreatedAt)],
    ['Holders', (r) => (r.holders.count != null ? r.holders.count.toLocaleString() : '—')],
    ['Top 10 hold', (r) => (r.holders.top10Pct != null ? (r.holders.top10Pct * 100).toFixed(1) + '%' : '—')],
    ['Warning signs', (r) => r.findings.filter((f) => ['critical', 'high', 'medium'].includes(f.severity)).map((f) => `• ${esc(f.title)}`).join('<br>') || '<span class="dim">none</span>'],
  ];
  out.innerHTML = `<div class="tbl-wrap"><table class="t cmp"><thead><tr><th></th>${reps.map((r, i) => `<th>${r ? `<a href="${href(`/scan/${r.chain}/${r.address}`)}" data-link>${esc(r.symbol)}</a>` : esc(items[i].address.slice(0, 8))}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(([k, fn]) => `<tr><td class="dim">${k}</td>${cell(fn)}</tr>`).join('')}</tbody></table></div>`;
}
