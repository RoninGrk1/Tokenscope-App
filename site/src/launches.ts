import { CHAINS, CHAIN_LIST } from '../../shared/config';
import { fetchLaunches, type LaunchItem } from '../../shared/data';
import { scanToken, fmtUsd } from '../../shared/risk';
import { esc, href, layout, levelBadge, setMeta, ago, shortAddr } from './ui';

let cache: { at: number; items: LaunchItem[] } | null = null;

export async function launchesView(root: HTMLElement, params: URLSearchParams) {
  setMeta('New token launches · Tokenscope');
  const filter = params.get('chain') ?? 'all';
  root.innerHTML = layout(`
    <div class="row between"><div><h1 style="font-size:36px;margin-bottom:6px">New launches</h1><p class="muted" style="margin:0">Newest token profiles on DexScreener for supported chains. New tokens are high risk by nature. Scan before you buy.</p></div>
    <button class="btn ghost" id="refresh">↻ Refresh</button></div>
    <div class="seg section" style="margin-top:18px" id="filters">${['all', ...CHAIN_LIST.map((c) => c.key)].map((k) => `<button data-c="${k}" class="${k === filter ? 'on' : ''}">${k === 'all' ? 'All chains' : CHAINS[k as keyof typeof CHAINS].name}</button>`).join('')}</div>
    <div id="list" class="stack" style="margin-top:16px"><div class="skeleton" style="height:64px"></div><div class="skeleton" style="height:64px"></div><div class="skeleton" style="height:64px"></div></div>`, '/launches');
  const list = root.querySelector<HTMLElement>('#list')!;
  const draw = async (force = false) => {
    try {
      if (force || !cache || Date.now() - cache.at > 60_000) cache = { at: Date.now(), items: await fetchLaunches(undefined, 40) };
      const items = cache.items.filter((i) => filter === 'all' || i.chain.key === filter);
      list.innerHTML = items.length ? items.map(row).join('') : `<div class="muted">No new launches on this chain right now.</div>`;
      list.querySelectorAll<HTMLButtonElement>('button[data-check]').forEach((b) => b.addEventListener('click', async () => {
        const [c, a] = b.dataset.check!.split(':'); b.disabled = true; b.innerHTML = '<span class="spinner"></span>';
        try { const r = await scanToken(CHAINS[c as keyof typeof CHAINS], a); b.outerHTML = `<a href="${href(`/scan/${c}/${a}`)}" data-link>${levelBadge(r.level, r.score)}</a>`; }
        catch { b.disabled = false; b.textContent = 'Retry'; }
      }));
    } catch (e) { list.innerHTML = `<div class="notice danger">Couldn’t load launches: ${esc((e as Error).message)}</div>`; }
  };
  root.querySelector('#refresh')!.addEventListener('click', () => void draw(true));
  root.querySelectorAll<HTMLButtonElement>('#filters button').forEach((b) => b.addEventListener('click', () => {
    const u = new URL(location.href); if (b.dataset.c === 'all') u.searchParams.delete('chain'); else u.searchParams.set('chain', b.dataset.c!);
    history.replaceState(null, '', u); void launchesView(root, u.searchParams);
  }));
  await draw();
}

function row(i: LaunchItem): string {
  const p = i.pair;
  const name = p ? `${esc(p.baseToken.symbol)} <span class="muted">${esc(p.baseToken.name)}</span>` : `<span class="mono">${esc(shortAddr(i.address))}</span>`;
  return `<div class="hit" style="cursor:default">
    ${i.icon ? `<img src="${esc(i.icon)}" alt="" loading="lazy">` : '<span class="ph"></span>'}
    <div style="min-width:0;flex:1"><a href="${href(`/scan/${i.chain.key}/${i.address}`)}" data-link style="color:var(--text)"><b>${name}</b></a>
      <div class="small muted" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc((i.description ?? '').slice(0, 120))}</div></div>
    <div class="small muted" style="text-align:right;white-space:nowrap"><span class="pill">${esc(i.chain.name)}</span><div>Liq ${fmtUsd(p?.liquidity?.usd ?? null)} · ${p?.pairCreatedAt ? ago(p.pairCreatedAt) + ' old' : 'no pool'}</div></div>
    <button class="btn ghost sm" data-check="${i.chain.key}:${esc(i.address)}">Quick check</button>
  </div>`;
}
