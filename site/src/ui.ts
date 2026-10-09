import { DISCLAIMER } from '../../shared/config';

export const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
export const API_BASE: string = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '');
export const REPO_URL = 'https://github.com/RoninGrk1/Tokenscope-App';

export const href = (path: string) => `${BASE}${path.startsWith('/') ? path : '/' + path}`;

export function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function shortAddr(a: string): string { return a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a; }

export function toast(msg: string) {
  const el = document.createElement('div'); el.className = 'toast'; el.textContent = msg;
  document.body.appendChild(el); setTimeout(() => el.remove(), 1800);
}

export async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); toast('Copied'); }
  catch { const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); toast('Copied'); }
}

export function setMeta(title: string, description?: string) {
  document.title = title;
  if (description) document.querySelector('meta[name="description"]')?.setAttribute('content', description);
  document.querySelector('meta[property="og:title"]')?.setAttribute('content', title);
}

export const LOGO = `<svg viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="lg" x1="0" x2="1"><stop offset="0" stop-color="#34d399"/><stop offset="1" stop-color="#22d3ee"/></linearGradient></defs><circle cx="28" cy="28" r="18" fill="none" stroke="url(#lg)" stroke-width="7"/><path d="M41 41l14 14" stroke="url(#lg)" stroke-width="8" stroke-linecap="round"/><path d="M20 29l6 6 11-13" fill="none" stroke="#34d399" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

export function layout(content: string, active = ''): string {
  const nav = [['/', 'Scan'], ['/compare', 'Compare'], ['/launches', 'New launches'], ['/api', 'API & MCP'], ['/pricing', 'Pricing']];
  return `
  <header class="top"><div class="wrap">
    <a class="logo" href="${href('/')}" data-link>${LOGO}<span>Tokenscope</span></a>
    <button class="burger" aria-label="Menu" id="burger">☰</button>
    <nav class="main" id="nav">
      ${nav.map(([p, l]) => `<a href="${href(p)}" data-link class="${active === p ? 'active' : ''}">${l}</a>`).join('')}
      <a class="cta" href="${href('/checkout?plan=pro&days=30')}" data-link>Get Pro</a>
    </nav>
  </div></header>
  <main><div class="wrap">${content}</div></main>
  <footer class="foot"><div class="wrap">
    <div class="disclaimer"><b>Disclaimer:</b> ${esc(DISCLAIMER)}</div>
    <div class="links">
      <a href="${href('/pricing')}" data-link>Pricing</a><a href="${href('/api')}" data-link>API & MCP</a>
      <a href="${href('/terms')}" data-link>Terms</a><a href="${href('/privacy')}" data-link>Privacy</a><a href="${href('/refunds')}" data-link>Refund policy</a>
      <a href="${REPO_URL}" target="_blank" rel="noopener">GitHub</a>
    </div>
    <div>© ${new Date().getFullYear()} Tokenscope. Data from DexScreener and GoPlus Security. Tokenscope never holds your funds and never asks for private keys or seed phrases.</div>
  </div></footer>`;
}

export function levelBadge(level: string, score?: number): string {
  const label = level === 'low' ? 'Low risk' : level === 'moderate' ? 'Moderate risk' : level === 'high' ? 'High risk' : 'Unknown';
  return `<span class="badge lv-${level}">${label}${score != null && level !== 'unknown' ? ` · ${score}/100` : ''}</span>`;
}

export function gauge(score: number, level: string): string {
  const r = 54, c = 2 * Math.PI * r, off = c * (1 - score / 100);
  const col = level === 'high' ? '#f87171' : level === 'moderate' ? '#facc15' : level === 'low' ? '#34d399' : '#6b7488';
  return `<div class="gauge"><svg width="132" height="132" viewBox="0 0 132 132"><circle cx="66" cy="66" r="${r}" stroke="#242a38" stroke-width="12" fill="none"/>
  <circle cx="66" cy="66" r="${r}" stroke="${col}" stroke-width="12" fill="none" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${off}"/></svg>
  <div class="val"><div><b style="color:${col}">${level === 'unknown' ? '?' : score}</b><span>risk score</span></div></div></div>`;
}

const FREE_KEY = 'ts_free_scans';
export const FREE_DAILY = 25;
/** Soft, client-side daily counter for the free tier. Real enforcement lives in the Worker. */
export function countScan(): { used: number; over: boolean } {
  const today = new Date().toISOString().slice(0, 10);
  let d = { day: today, n: 0 };
  try { const raw = JSON.parse(localStorage.getItem(FREE_KEY) ?? 'null'); if (raw?.day === today) d = raw; } catch { /* ignore */ }
  d.n += 1; try { localStorage.setItem(FREE_KEY, JSON.stringify(d)); } catch { /* ignore */ }
  return { used: d.n, over: d.n > FREE_DAILY };
}

export function ago(ts: number | null | undefined): string {
  if (!ts) return '—';
  const h = (Date.now() - ts) / 3_600_000;
  if (h < 1) return `${Math.max(1, Math.round(h * 60))}m`;
  if (h < 48) return `${Math.round(h)}h`;
  if (h < 24 * 60) return `${Math.round(h / 24)}d`;
  return `${(h / 24 / 365).toFixed(1)}y`;
}
