import QRCode from 'qrcode';
import { RECEIVING, USDC } from '../../shared/config';
import { PLANS, PERIODS, CREDIT_PACKS, REFUND_RULE, INVOICE_TTL_MINUTES, productPrice, productLabel, ethUniqueAmount, type ProductRef, type PlanId, type PeriodDays } from '../../shared/pricing';
import { solanaPayUrl, eip681UsdcUrl } from '../../shared/payments';
import { randomReference } from '../../shared/base58';
import { API_BASE, esc, href, layout, setMeta, copyText } from './ui';
import { navigate } from './router';

type PayChain = 'solana' | 'ethereum';

interface Invoice {
  id: string; chain: PayChain; amount: string; amountUnits: string; recipient: string; token: string;
  reference?: string; paymentUrl: string; expiresAt: number; status: string; preview: boolean; apiKey?: string;
}

function parseProduct(p: URLSearchParams): ProductRef {
  const pack = p.get('pack');
  if (pack && CREDIT_PACKS.some((c) => c.id === pack)) return { kind: 'credits', pack };
  const plan = (p.get('plan') ?? 'pro') as PlanId;
  let days = Number(p.get('days') ?? 30) as PeriodDays; if (!PERIODS.includes(days)) days = 30;
  return { kind: 'plan', plan: PLANS[plan] ? plan : 'pro', days };
}

function previewInvoice(product: ProductRef, chain: PayChain): Invoice {
  const price = productPrice(product);
  const expiresAt = Date.now() + INVOICE_TTL_MINUTES * 60_000;
  if (chain === 'solana') {
    const reference = randomReference();
    const amount = price.toFixed(2);
    return { id: 'preview', chain, amount, amountUnits: String(Math.round(price * 1e6)), recipient: RECEIVING.solana, token: USDC.solana.mint, reference, expiresAt, status: 'preview', preview: true,
      paymentUrl: solanaPayUrl({ amount: String(price), reference, label: 'Tokenscope', message: productLabel(product) }) };
  }
  const suffix = 1 + Math.floor(Math.random() * 9999);
  const { display, units } = ethUniqueAmount(price, suffix);
  return { id: 'preview', chain, amount: display, amountUnits: units.toString(), recipient: RECEIVING.ethereum, token: USDC.ethereum.address, expiresAt, status: 'preview', preview: true, paymentUrl: eip681UsdcUrl(units) };
}

/** Never show an address the backend returns unless it matches the audited constant. */
function assertAddresses(inv: Invoice): string | null {
  if (inv.recipient !== RECEIVING[inv.chain]) return 'The server returned a receiving address that does not match the published one. Do NOT pay. Please contact support.';
  const tok = inv.chain === 'solana' ? USDC.solana.mint : USDC.ethereum.address;
  if (inv.token !== tok) return 'The server returned an unexpected USDC token address. Do NOT pay.';
  return null;
}

export function checkoutView(root: HTMLElement, params: URLSearchParams) {
  setMeta('Checkout · Tokenscope');
  const product = parseProduct(params);
  const chain: PayChain = params.get('chain') === 'ethereum' ? 'ethereum' : 'solana';
  const price = productPrice(product);
  const isPlan = product.kind === 'plan';
  const setParam = (k: string, v: string | null) => { const u = new URLSearchParams(location.search); if (v == null) u.delete(k); else u.set(k, v); navigate(`/checkout?${u}`, true); };
  const live = !!API_BASE;

  root.innerHTML = layout(`
    <div class="grid g2" style="align-items:start">
      <div class="stack">
        <div><a href="${href('/pricing')}" data-link class="small">← Back to pricing</a><h1 style="font-size:34px;margin-top:8px">Checkout</h1></div>
        <div class="card stack">
          <div><label class="lbl">Product</label>
            <select class="field" id="product">
              ${Object.values(PLANS).flatMap((p) => PERIODS.map((d) => `<option value="plan:${p.id}:${d}" ${isPlan && product.plan === p.id && product.days === d ? 'selected' : ''}>${esc(p.name)} · ${d} days · $${p.prices[d]}</option>`)).join('')}
              ${CREDIT_PACKS.map((c) => `<option value="pack:${c.id}" ${!isPlan && product.pack === c.id ? 'selected' : ''}>Credits · ${c.calls.toLocaleString('en-US')} calls · $${c.price}</option>`).join('')}
            </select></div>
          <div><label class="lbl">Pay with</label>
            <div class="seg" id="chainseg"><button data-c="solana" class="${chain === 'solana' ? 'on' : ''}">USDC on Solana <span class="small" style="color:var(--accent)">recommended</span></button><button data-c="ethereum" class="${chain === 'ethereum' ? 'on' : ''}">USDC on Ethereum</button></div></div>
          ${chain === 'ethereum' && (!isPlan || product.days === 30) ? `<div class="notice warn">Ethereum gas for a USDC transfer can be a few dollars. ${isPlan ? `Consider the <a href="#" data-days="90">90-day ($${PLANS[product.plan].prices[90]})</a> or <a href="#" data-days="365">365-day ($${PLANS[product.plan].prices[365]})</a> plan so gas is a smaller share, or ` : 'Consider '}<a href="#" data-c2="solana">paying on Solana</a> (fees under a cent).</div>` : ''}
          ${live ? `<div><label class="lbl">Email (for your API key and expiry reminders)</label><input class="field" id="email" type="email" placeholder="you@example.com"></div>` : ''}
          <div class="row between"><div><div class="dim small">Total</div><div class="price" style="font-size:30px">$${price} <small>USDC</small></div></div>
          <button class="btn" id="create">${live ? 'Create invoice' : 'Show payment details'}</button></div>
          <div class="small muted">${esc(productLabel(product))}. Prepaid, no auto-renew. Paying before expiry adds time to the end of your current period.</div>
        </div>
        <div class="notice warn"><b>Refunds:</b> ${esc(REFUND_RULE)}</div>
      </div>
      <div id="inv"></div>
    </div>`, '/pricing');

  root.querySelector<HTMLSelectElement>('#product')!.addEventListener('change', (e) => {
    const v = (e.target as HTMLSelectElement).value.split(':');
    const u = new URLSearchParams(); if (v[0] === 'plan') { u.set('plan', v[1]); u.set('days', v[2]); } else u.set('pack', v[1]);
    u.set('chain', chain); navigate(`/checkout?${u}`, true);
  });
  root.querySelectorAll<HTMLButtonElement>('#chainseg button').forEach((b) => b.addEventListener('click', () => setParam('chain', b.dataset.c!)));
  root.querySelectorAll<HTMLAnchorElement>('a[data-days]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); setParam('days', a.dataset.days!); }));
  root.querySelectorAll<HTMLAnchorElement>('a[data-c2]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); setParam('chain', a.dataset.c2!); }));
  root.querySelector<HTMLButtonElement>('#create')!.addEventListener('click', async (e) => {
    const btn = e.currentTarget as HTMLButtonElement; btn.disabled = true;
    const out = root.querySelector<HTMLElement>('#inv')!;
    try {
      let inv: Invoice;
      if (live) {
        const email = root.querySelector<HTMLInputElement>('#email')?.value.trim();
        const res = await fetch(`${API_BASE}/api/checkout/invoices`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ product, chain, email }) });
        if (!res.ok) throw new Error(await res.text());
        inv = { ...(await res.json()), preview: false };
      } else inv = previewInvoice(product, chain);
      await renderInvoice(out, inv);
    } catch (err) { out.innerHTML = `<div class="notice danger">Couldn’t create invoice: ${esc((err as Error).message)}</div>`; }
    finally { btn.disabled = false; }
  });
}

let timer: number | undefined;

async function renderInvoice(out: HTMLElement, inv: Invoice) {
  const bad = assertAddresses(inv);
  if (bad) { out.innerHTML = `<div class="notice danger"><b>Stop.</b> ${esc(bad)}</div>`; return; }
  const qr = await QRCode.toDataURL(inv.paymentUrl, { margin: 1, width: 440, errorCorrectionLevel: 'M' });
  const sol = inv.chain === 'solana';
  out.innerHTML = `<div class="card stack">
    ${inv.preview ? `<div class="notice danger"><b>Preview mode — do not send funds yet.</b> This GitHub Pages site is static: it can show payment details, but it can’t record invoices, verify payments or issue API keys. That runs on the Tokenscope Worker backend, which isn’t live yet. A payment sent now could not be matched automatically.</div>` : ''}
    <div class="row between"><h2 style="margin:0">Pay ${esc(inv.amount)} USDC</h2><span class="badge lv-moderate" id="status">${inv.preview ? 'Preview' : 'Awaiting payment'}</span></div>
    <div class="row" style="align-items:flex-start;gap:18px">
      <img class="qr" src="${qr}" alt="Payment QR code">
      <div class="stack" style="flex:1;min-width:220px;gap:10px">
        <div><label class="lbl">Network</label><b>${sol ? 'Solana' : 'Ethereum mainnet'}</b> · USDC ${sol ? '(SPL)' : '(ERC-20)'}</div>
        <div><label class="lbl">Exact amount</label><div class="row" style="gap:8px"><b class="mono" style="font-size:18px">${esc(inv.amount)}</b><button class="copy" data-copy="${esc(inv.amount)}">Copy</button></div>
          ${sol ? '' : `<div class="small muted">The last digits identify your invoice (Ethereum has no memo field). Send exactly this amount.</div>`}</div>
        <div><label class="lbl">Receiving address</label><div class="addr" style="color:var(--text);font-size:14px">${esc(inv.recipient)}</div><button class="copy" data-copy="${esc(inv.recipient)}" style="margin-top:6px">Copy address</button></div>
        <div><label class="lbl">USDC ${sol ? 'mint' : 'contract'}</label><div class="addr">${esc(inv.token)}</div></div>
        ${inv.reference ? `<div><label class="lbl">Solana Pay reference</label><div class="addr">${esc(inv.reference)}</div></div>` : ''}
        <div class="row"><a class="btn sm" href="${esc(inv.paymentUrl)}">Open in wallet</a><button class="btn ghost sm" data-copy="${esc(inv.paymentUrl)}">Copy ${sol ? 'Solana Pay' : 'EIP-681'} link</button></div>
      </div>
    </div>
    <div class="small muted">Invoice expires in <b id="countdown">30:00</b>. ${sol ? 'Scan with Phantom, Solflare or any Solana Pay wallet. The payment is matched by its reference key once finalized.' : 'Matched automatically after ~12 confirmations.'}</div>
    ${!sol && !inv.preview ? `<div><label class="lbl">Already paid? Paste the tx hash to speed things up</label><div class="row" style="flex-wrap:nowrap"><input class="field mono" id="txh" placeholder="0x…"><button class="btn ghost" id="txbtn">Submit</button></div></div>` : ''}
    <div class="small dim">Check the address character by character in your wallet before confirming. Only send USDC on the network shown. Other tokens or networks can’t be recovered.</div>
  </div>`;
  out.querySelectorAll<HTMLElement>('[data-copy]').forEach((b) => b.addEventListener('click', () => copyText(b.dataset.copy!)));
  window.clearInterval(timer);
  const tick = async () => {
    const left = Math.max(0, inv.expiresAt - Date.now());
    const el = out.querySelector('#countdown'); if (!el) { window.clearInterval(timer); return; }
    el.textContent = `${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, '0')}`;
    if (left === 0) { out.querySelector('#status')!.textContent = 'Expired'; window.clearInterval(timer); }
  };
  timer = window.setInterval(tick, 1000); void tick();
  if (!inv.preview) pollInvoice(out, inv);
}

function pollInvoice(out: HTMLElement, inv: Invoice) {
  out.querySelector('#txbtn')?.addEventListener('click', async () => {
    const tx = out.querySelector<HTMLInputElement>('#txh')!.value.trim();
    await fetch(`${API_BASE}/api/checkout/invoices/${inv.id}/tx`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ txHash: tx }) });
  });
  const poll = async () => {
    if (!out.isConnected) return;
    try {
      const r = await (await fetch(`${API_BASE}/api/checkout/invoices/${inv.id}`)).json();
      const st = out.querySelector('#status');
      if (st) st.textContent = r.status === 'paid' ? 'Paid · activated' : r.status === 'confirming' ? 'Payment seen · confirming' : r.status === 'expired' ? 'Expired' : 'Awaiting payment';
      if (r.status === 'paid') {
        out.insertAdjacentHTML('afterbegin', `<div class="notice info" style="margin-bottom:12px"><b>Payment confirmed.</b> Your plan is active.${r.apiKey ? ` Your API key (shown once): <code>${esc(r.apiKey)}</code>` : ' Check your email for your API key.'}</div>`);
        return;
      }
      if (r.status !== 'expired') setTimeout(poll, 6000);
    } catch { setTimeout(poll, 10000); }
  };
  setTimeout(poll, 4000);
}
