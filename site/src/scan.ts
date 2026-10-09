import { CHAINS, CHAIN_LIST, detectAddressKind, type ChainInfo, type ChainKey } from '../../shared/config';
import { searchTokens, type SearchHit } from '../../shared/data';
import { scanToken, fmtUsd, type RiskReport } from '../../shared/risk';
import { POPULAR } from '../../shared/popular';
import { esc, href, layout, levelBadge, gauge, copyText, setMeta, countScan, FREE_DAILY, shortAddr, ago } from './ui';
import { navigate } from './router';

export function scanForm(chain: ChainKey | 'auto' = 'auto', value = ''): string {
  return `<form class="scanbox" id="scanform" autocomplete="off">
    <select id="chain" aria-label="Chain"><option value="auto">Auto-detect</option>${CHAIN_LIST.map((c) => `<option value="${c.key}" ${c.key === chain ? 'selected' : ''}>${c.name}</option>`).join('')}</select>
    <input id="q" placeholder="Paste a token address or search by name / symbol" value="${esc(value)}" aria-label="Token address or name" />
    <button class="btn" type="submit" id="scanbtn">Scan</button>
  </form><div class="hits" id="hits"></div>`;
}

export function bindScanForm(root: HTMLElement) {
  const form = root.querySelector<HTMLFormElement>('#scanform'); if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = (root.querySelector<HTMLInputElement>('#q')!.value || '').trim();
    const sel = root.querySelector<HTMLSelectElement>('#chain')!.value as ChainKey | 'auto';
    const hits = root.querySelector<HTMLElement>('#hits')!;
    if (!q) return;
    const kind = detectAddressKind(q);
    if (kind) {
      let chain: ChainKey = sel === 'auto' ? (kind === 'solana' ? 'solana' : 'ethereum') : sel;
      if (CHAINS[chain].kind !== kind) chain = kind === 'solana' ? 'solana' : 'ethereum';
      if (sel === 'auto' && kind === 'evm') {
        // Find which EVM chain actually lists this token.
        hits.innerHTML = `<div class="muted small" style="text-align:center"><span class="spinner"></span> Finding chain…</div>`;
        try { const found = (await searchTokens(q)).find((h) => h.address.toLowerCase() === q.toLowerCase()); if (found) chain = found.chain.key; } catch { /* default to ethereum */ }
      }
      navigate(`/scan/${chain}/${q}`); return;
    }
    hits.innerHTML = `<div class="muted small" style="text-align:center"><span class="spinner"></span> Searching…</div>`;
    try {
      let res = await searchTokens(q);
      if (sel !== 'auto') res = res.filter((h) => h.chain.key === sel);
      hits.innerHTML = res.length ? res.slice(0, 10).map(hitRow).join('') : `<div class="muted" style="text-align:center">No tokens found on supported chains. Try pasting the contract address.</div>`;
    } catch (err) { hits.innerHTML = `<div class="notice danger">Search failed: ${esc((err as Error).message)}</div>`; }
  });
}

function hitRow(h: SearchHit): string {
  return `<a class="hit" href="${href(`/scan/${h.chain.key}/${h.address}`)}" data-link>
    ${h.imageUrl ? `<img src="${esc(h.imageUrl)}" alt="" loading="lazy">` : `<span class="ph"></span>`}
    <div style="min-width:0"><b>${esc(h.symbol)}</b> <span class="muted">${esc(h.name)}</span><div class="addr">${esc(shortAddr(h.address))}</div></div>
    <div style="margin-left:auto;text-align:right"><span class="pill">${esc(h.chain.name)}</span><div class="small muted">Liq ${fmtUsd(h.liquidityUsd)} · ${ago(h.pairCreatedAt)}</div></div></a>`;
}

const SEV_LABEL: Record<string, string> = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low', info: 'Info', good: 'Good' };

export function reportHtml(r: RiskReport, chain: ChainInfo): string {
  const m = r.market;
  const share = shareUrl(r);
  const red = r.findings.filter((f) => ['critical', 'high', 'medium', 'low'].includes(f.severity));
  const good = r.findings.filter((f) => f.severity === 'good' || f.severity === 'info');
  const finding = (f: RiskReport['findings'][number]) => `<div class="finding sev-${f.severity}"><span class="sevtag st-${f.severity}">${SEV_LABEL[f.severity]}</span><div><div class="t">${esc(f.title)}</div><div class="d">${esc(f.detail)}</div></div><span class="src">${esc(f.source)}</span></div>`;
  return `
  <div class="card stack" id="report">
    <div class="report-head">
      ${m.imageUrl ? `<img class="token-ico" src="${esc(m.imageUrl)}" alt="">` : `<div class="token-ico">${esc(r.symbol.slice(0, 3))}</div>`}
      <div style="flex:1;min-width:220px">
        <div class="row"><h2 style="margin:0">${esc(r.name)} <span class="muted">(${esc(r.symbol)})</span></h2><span class="pill">${esc(r.chainName)}</span></div>
        <div class="row" style="gap:8px;margin-top:6px"><span class="addr">${esc(r.address)}</span><button class="copy" data-copy="${esc(r.address)}">Copy</button><a class="small" href="${chain.explorer}${esc(r.address)}" target="_blank" rel="noopener">Explorer ↗</a>${m.topPairUrl ? `<a class="small" href="${esc(m.topPairUrl)}" target="_blank" rel="noopener">Chart ↗</a>` : ''}</div>
        <div style="margin-top:12px">${levelBadge(r.level, r.score)}</div>
        <p style="margin:10px 0 0;font-size:17px">${esc(r.verdict)}</p>
      </div>
      ${gauge(r.score, r.level)}
    </div>
    <div class="stats">
      <div class="stat"><div class="k">Price</div><div class="v">${fmtUsd(m.priceUsd)}</div></div>
      <div class="stat"><div class="k">Liquidity</div><div class="v">${fmtUsd(m.liquidityUsd)}</div></div>
      <div class="stat"><div class="k">24h volume</div><div class="v">${fmtUsd(m.volume24h)}</div></div>
      <div class="stat"><div class="k">FDV</div><div class="v">${fmtUsd(m.fdv)}</div></div>
      <div class="stat"><div class="k">Pool age</div><div class="v">${ago(m.pairCreatedAt)}</div></div>
      <div class="stat"><div class="k">24h buys / sells</div><div class="v">${m.buys24h.toLocaleString()} / ${m.sells24h.toLocaleString()}</div></div>
      <div class="stat"><div class="k">Holders</div><div class="v">${r.holders.count != null ? r.holders.count.toLocaleString() : '—'}</div></div>
      <div class="stat"><div class="k">Top 10 hold</div><div class="v">${r.holders.top10Pct != null ? (r.holders.top10Pct * 100).toFixed(1) + '%' : '—'}</div></div>
    </div>
    <div><h3>Warning signs (${red.length})</h3><div class="findings">${red.length ? red.map(finding).join('') : `<div class="muted">No warning signs found by the automated checks.</div>`}</div></div>
    ${good.length ? `<div><h3>Positive signals & notes</h3><div class="findings">${good.map(finding).join('')}</div></div>` : ''}
    <div class="row between">
      <div class="row">
        <button class="btn ghost sm" data-copy="${esc(share)}">Copy share link</button>
        <a class="btn ghost sm" href="${href(`/compare?t=${r.chain}:${r.address}`)}" data-link>Compare</a>
        <button class="btn ghost sm" id="rawbtn">Raw JSON</button>
        <a class="btn ghost sm" href="${href('/pricing')}" data-link title="Watches need a Pro plan">🔔 Watch</a>
      </div>
      <span class="small dim">Scanned ${new Date(r.generatedAt).toLocaleString()} · DexScreener + GoPlus</span>
    </div>
    <pre id="raw" hidden>${esc(JSON.stringify(r, null, 2))}</pre>
  </div>`;
}

export function shareUrl(r: { chain: string; address: string }): string {
  const pop = POPULAR.find((p) => p.chain === r.chain && p.address.toLowerCase() === r.address.toLowerCase());
  const path = pop ? `/is/${pop.slug}-safe` : `/is/${r.address}-safe${r.chain === 'ethereum' || r.chain === 'solana' ? '' : `?chain=${r.chain}`}`;
  return `${location.origin}${href(path)}`;
}

export function bindReport(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>('[data-copy]').forEach((b) => b.addEventListener('click', () => copyText(b.dataset.copy!)));
  root.querySelector('#rawbtn')?.addEventListener('click', () => { const p = root.querySelector<HTMLElement>('#raw')!; p.hidden = !p.hidden; });
}

export async function scanView(root: HTMLElement, chainKey: string, address: string, opts: { seoTitle?: string } = {}) {
  const chain = CHAINS[chainKey as ChainKey];
  if (!chain) { root.innerHTML = layout(`<div class="notice danger">Unknown chain “${esc(chainKey)}”.</div>`); return; }
  setMeta(opts.seoTitle ?? `Token scan ${shortAddr(address)} on ${chain.name} · Tokenscope`);
  root.innerHTML = layout(`
    <div style="margin-bottom:18px">${scanForm(chain.key, address)}</div>
    ${opts.seoTitle ? `<h1 style="font-size:30px;margin-top:6px">${esc(opts.seoTitle.replace(' · Tokenscope', ''))}</h1>` : ''}
    <div id="out"><div class="card stack"><div class="row"><span class="spinner"></span><span class="muted">Scanning contract, liquidity and holders on ${esc(chain.name)}…</span></div><div class="skeleton" style="height:120px"></div><div class="skeleton" style="height:200px"></div></div></div>`, '/');
  bindScanForm(root);
  const out = root.querySelector<HTMLElement>('#out')!;
  const usage = countScan();
  if (usage.over) {
    out.innerHTML = `<div class="card stack"><h2>Daily free limit reached</h2><p class="muted">The free plan includes ${FREE_DAILY} website scans per day. Pro gives you unlimited scans, compare and 10 watches.</p><div><a class="btn" href="${href('/pricing')}" data-link>See plans</a></div></div>`;
    return;
  }
  try {
    const r = await scanToken(chain, address);
    if (opts.seoTitle) setMeta(`Is ${r.symbol} safe? ${r.name} risk scan · Tokenscope`, `${r.name} (${r.symbol}) on ${r.chainName}: ${r.verdict} Automated risk score ${r.score}/100.`);
    else setMeta(`${r.symbol} risk scan: ${r.level === 'unknown' ? 'unknown' : r.level + ' risk'} · Tokenscope`, `${r.name} (${r.symbol}) on ${r.chainName}: ${r.verdict}`);
    out.innerHTML = reportHtml(r, chain);
    bindReport(out);
  } catch (err) {
    out.innerHTML = `<div class="notice danger">Scan failed: ${esc((err as Error).message)}. The data providers may be rate-limiting; try again in a moment.</div>`;
  }
}

/** /is/<slug>-safe : popular slug, raw address, or symbol search. */
export async function isSafeView(root: HTMLElement, slug: string, params: URLSearchParams) {
  const pop = POPULAR.find((p) => p.slug === slug.toLowerCase());
  if (pop) return scanView(root, pop.chain, pop.address, { seoTitle: `Is ${pop.symbol} safe? · Tokenscope` });
  const kind = detectAddressKind(slug);
  if (kind) {
    const chain = params.get('chain') ?? (kind === 'solana' ? 'solana' : 'ethereum');
    return scanView(root, chain, slug, { seoTitle: `Is ${shortAddr(slug)} safe? · Tokenscope` });
  }
  root.innerHTML = layout(`<div class="card"><span class="spinner"></span> Looking up “${esc(slug)}”…</div>`);
  try {
    const hits = await searchTokens(slug);
    const best = hits.find((h) => h.symbol.toLowerCase() === slug.toLowerCase()) ?? hits[0];
    if (best) return scanView(root, best.chain.key, best.address, { seoTitle: `Is ${best.symbol} safe? · Tokenscope` });
  } catch { /* fallthrough */ }
  root.innerHTML = layout(`<div class="notice warn">No token found for “${esc(slug)}”.</div><div style="margin-top:16px">${scanForm()}</div>`);
  bindScanForm(root);
}
