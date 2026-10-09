import { layout, href, setMeta, esc } from './ui';
import { scanForm, bindScanForm } from './scan';
import { POPULAR } from '../../shared/popular';
import { CHAIN_LIST } from '../../shared/config';

export function homeView(root: HTMLElement) {
  setMeta('Tokenscope · Instant token risk scans for people and AI agents');
  const features = [
    ['🍯', 'Honeypot & tax checks', 'Sell simulation, buy/sell tax, tax-change and per-wallet tax switches.'],
    ['🔑', 'Authority & owner powers', 'Mint, freeze, pause, blacklist, proxy upgrades, hidden owners, balance changes.'],
    ['💧', 'Liquidity & market', 'Pool depth, pool age, buy/sell imbalance, crashes and thin liquidity vs valuation.'],
    ['🐋', 'Holder concentration', 'Top-wallet share, excluding pools, burn addresses and locked tokens.'],
    ['🤖', 'API + MCP for agents', 'scan_token, compare_tokens, new_launches and watch_address for AI agents and bots.'],
    ['🔔', 'Alerts', 'Watch addresses and get Telegram or Discord alerts when risk changes.'],
  ];
  root.innerHTML = layout(`
    <section class="hero">
      <div class="badge lv-low" style="margin-bottom:16px">Free · No sign-up · ${CHAIN_LIST.length} chains</div>
      <h1>Is that token safe?<br><span class="grad">Scan it in seconds.</span></h1>
      <p class="lead">Instant, evidence-backed risk signals for any token on ${CHAIN_LIST.map((c) => c.name).join(', ')}. Built for traders, and for AI agents via API + MCP.</p>
      ${scanForm()}
      <div class="chips">${POPULAR.slice(0, 8).map((p) => `<a class="chip" href="${href(`/is/${p.slug}-safe`)}" data-link>Is ${esc(p.symbol)}${p.slug.includes('-') ? ' (' + p.chain + ')' : ''} safe?</a>`).join('')}</div>
    </section>
    <section class="section grid g3">
      ${features.map(([i, t, d]) => `<div class="card feature"><div class="ico">${i}</div><h3>${t}</h3><div class="muted">${d}</div></div>`).join('')}
    </section>
    <section class="section grid g2">
      <div class="card stack"><h2>How the score works</h2>
        <p class="muted" style="margin:0">Each check produces a finding with a severity and the evidence behind it. Critical findings (like a failed sell simulation) force a <b>high risk</b> rating. Positive signals can soften the score but never hide a red flag. We describe risk; we never call a token a scam as a fact.</p>
        <div class="row"><span class="badge lv-low">0–14 low</span><span class="badge lv-moderate">15–44 moderate</span><span class="badge lv-high">45+ high</span></div>
      </div>
      <div class="card stack"><h2>For builders & agents</h2>
        <p class="muted" style="margin:0">Plug Tokenscope into your bot, wallet or AI agent. REST API and an MCP server with <code>scan_token</code>, <code>get_token_info</code>, <code>compare_tokens</code>, <code>new_launches</code> and <code>watch_address</code>.</p>
        <div class="row"><a class="btn" href="${href('/api')}" data-link>API & MCP docs</a><a class="btn ghost" href="${href('/pricing')}" data-link>Pricing</a></div>
      </div>
    </section>
    <section class="section card row between">
      <div><h2 style="margin:0">Fresh launches, pre-screened</h2><div class="muted">The newest tokens on DexScreener, one click from a risk scan.</div></div>
      <a class="btn ghost" href="${href('/launches')}" data-link>View new launches →</a>
    </section>`, '/');
  bindScanForm(root);
}
