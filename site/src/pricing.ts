import { PLAN_LIST, PERIODS, CREDIT_PACKS, BILLING_RULES, REFUND_RULE, FREE_LIMITS, type PeriodDays } from '../../shared/pricing';
import { esc, href, layout, setMeta } from './ui';

export function pricingView(root: HTMLElement, params: URLSearchParams) {
  setMeta('Pricing · Tokenscope', 'Tokenscope plans: Pro $29, Builder (API + MCP) $79, Alerts Team $49 per 30 days. Pay in USDC on Solana or Ethereum. Pay-per-call credits from $10.');
  let days = (Number(params.get('days')) || 30) as PeriodDays; if (!PERIODS.includes(days)) days = 30;
  const draw = () => {
    root.innerHTML = layout(`
      <section class="hero" style="padding-bottom:6px"><h1 style="font-size:40px">Simple, prepaid pricing</h1>
        <p class="lead">Free website scans for everyone. Pay in <b>USDC on Solana or Ethereum</b> for more. No card, no processor, no auto-renew.</p>
        <div class="seg" id="period">${PERIODS.map((d) => `<button data-d="${d}" class="${d === days ? 'on' : ''}">${d} days${d === 90 ? ' · ~10% off' : d === 365 ? ' · ~20% off' : ''}</button>`).join('')}</div>
      </section>
      <section class="section grid g4" style="margin-top:22px">
        <div class="card price-card"><h3>Free</h3><div class="price">$0</div><div class="muted small">For quick checks</div>
          <ul class="check"><li>Website scans</li><li>Low daily limit (${FREE_LIMITS.siteScansPerDay}/day)</li><li>New launches list</li></ul>
          <a class="btn ghost" style="margin-top:auto" href="${href('/')}" data-link>Start scanning</a></div>
        ${PLAN_LIST.map((p) => `<div class="card price-card ${p.id === 'builder' ? 'featured' : ''}">
          <div class="row between"><h3 style="margin:0">${esc(p.name)}</h3>${p.id === 'builder' ? '<span class="badge lv-low">For agents</span>' : ''}</div>
          <div class="price">$${p.prices[days]}<small> USDC / ${days} days</small></div>
          <div class="muted small">${esc(p.tagline)}${days !== 30 ? ` · $${(p.prices[days] / (days / 30)).toFixed(2)}/30d` : ''}</div>
          <ul class="check">${p.features.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
          <a class="btn ${p.id === 'builder' ? '' : 'ghost'}" style="margin-top:auto" href="${href(`/checkout?plan=${p.id}&days=${days}`)}" data-link>Choose ${esc(p.name.split(' ')[0])}</a></div>`).join('')}
      </section>
      <section class="section"><h2>All plan prices (USDC)</h2>
        <div class="tbl-wrap"><table class="t"><thead><tr><th>Plan</th><th>30 days</th><th>90 days (~10% off)</th><th>365 days (~20% off)</th></tr></thead>
        <tbody>${PLAN_LIST.map((p) => `<tr><td><b>${esc(p.name)}</b></td>${PERIODS.map((d) => `<td>$${p.prices[d]}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      </section>
      <section class="section grid g2">
        <div class="card stack"><h2 style="margin:0">Pay-per-call credits</h2><p class="muted" style="margin:0">For agents that don’t want a subscription. <b>Credits don’t expire.</b></p>
          <div class="tbl-wrap"><table class="t"><thead><tr><th>Pack</th><th>Calls</th><th></th></tr></thead><tbody>
          ${CREDIT_PACKS.map((c) => `<tr><td><b>$${c.price}</b></td><td>${c.calls.toLocaleString('en-US')}</td><td><a class="btn ghost sm" href="${href(`/checkout?pack=${c.id}`)}" data-link>Buy</a></td></tr>`).join('')}
          </tbody></table></div></div>
        <div class="card stack"><h2 style="margin:0">Billing rules</h2><ul class="check">${BILLING_RULES.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
          <div class="notice warn"><b>Refunds:</b> ${esc(REFUND_RULE)} <a href="${href('/refunds')}" data-link>Refund policy</a></div>
          <div class="small muted">Network gas is paid by you. Solana fees are fractions of a cent; Ethereum USDC transfers can cost a few dollars, so on Ethereum the 90 or 365 day plans make more sense.</div></div>
      </section>`, '/pricing');
    root.querySelectorAll<HTMLButtonElement>('#period button').forEach((b) => b.addEventListener('click', () => { days = Number(b.dataset.d) as PeriodDays; const u = new URL(location.href); u.searchParams.set('days', String(days)); history.replaceState(null, '', u); draw(); }));
  };
  draw();
}
