import { DISCLAIMER } from '../../shared/config';
import { REFUND_RULE, BILLING_RULES } from '../../shared/pricing';
import { API_BASE, REPO_URL, esc, href, layout, setMeta } from './ui';

export function apiView(root: HTMLElement) {
  setMeta('API & MCP · Tokenscope');
  const base = API_BASE || 'https://tokenscope.pages.dev';
  root.innerHTML = layout(`<div class="prose">
    <h1 style="font-size:38px">API & MCP</h1>
    <p class="lead">Give your bot or AI agent a risk check before every trade. Available on the <a href="${href('/pricing')}" data-link>Builder plan</a> (50k calls per period) or with pay-per-call credits.</p>
    ${API_BASE ? '' : `<div class="notice warn">The hosted API runs on the Tokenscope Cloudflare Worker, which is not deployed yet. The endpoints below describe the backend in <a href="${REPO_URL}/tree/main/worker" target="_blank" rel="noopener">/worker</a>.</div>`}
    <h2>Authentication</h2><p>Send your key as <code>Authorization: Bearer ts_live_…</code>. Without a key you get the free daily limit per IP.</p>
    <h2>REST endpoints</h2>
    <pre>GET  ${base}/api/v1/scan?chain=ethereum&address=0xA0b8…eB48
GET  ${base}/api/v1/token?chain=solana&address=EPjF…Dt1v
GET  ${base}/api/v1/compare?tokens=ethereum:0x…,solana:…
GET  ${base}/api/v1/launches?chain=solana
POST ${base}/api/v1/watches   {"chain":"base","address":"0x…","channel":"telegram"}
GET  ${base}/api/v1/usage</pre>
    <p>Chains: <code>ethereum</code>, <code>solana</code>, <code>base</code>, <code>bsc</code>, <code>arbitrum</code>, <code>polygon</code>. Every response includes <code>score</code> (0–100, higher = riskier), <code>level</code>, <code>verdict</code> and a list of <code>findings</code> with severity, evidence and source.</p>
    <h2>MCP server (tokenscope-mcp)</h2>
    <p>Streamable HTTP endpoint at <code>${base}/mcp</code>. Tools: <code>scan_token</code>, <code>get_token_info</code>, <code>compare_tokens</code>, <code>new_launches</code>, <code>watch_address</code>.</p>
    <pre>{
  "mcpServers": {
    "tokenscope": {
      "url": "${base}/mcp",
      "headers": { "Authorization": "Bearer ts_live_YOUR_KEY" }
    }
  }
}</pre>
    <h2>Example response</h2>
    <pre>{
  "chain": "ethereum", "symbol": "USDC", "score": 0, "level": "low",
  "verdict": "Low risk signals: no major red flags found.",
  "findings": [{ "id": "proxy", "severity": "info", "title": "Upgradeable proxy", "source": "GoPlus", … }],
  "market": { "liquidityUsd": 3678463.57, "volume24h": 65738212.83, … }
}</pre>
  </div>`, '/api');
}

const CONTACT = `<a href="${REPO_URL}/issues" target="_blank" rel="noopener">GitHub issues</a>`;

export function legalView(root: HTMLElement, page: 'terms' | 'privacy' | 'refunds') {
  const updated = 'October 2026';
  const pages = {
    terms: ['Terms of Service', `
      <p>By using Tokenscope (the website, API and MCP server) you agree to these terms.</p>
      <h2>Not advice, not an audit</h2><p>${esc(DISCLAIMER)} Risk scores are generated automatically from third-party data (DexScreener, GoPlus Security and public blockchain data) and may be incomplete, delayed or wrong. A low score does not mean a token is safe, and a high score is a description of risk signals, not a statement that a project is fraudulent. You are solely responsible for your trading decisions.</p>
      <h2>Accounts, keys and plans</h2><p>Paid plans are prepaid for a fixed period (30, 90 or 365 days) and do not auto-renew. ${BILLING_RULES.map(esc).join(' ')} Keep your API key secret; you are responsible for usage under your key. We may suspend keys used for abuse, scraping beyond limits or attacks on the service.</p>
      <h2>Payments</h2><p>We accept USDC on Ethereum and Solana only, sent directly to our published receiving addresses. You pay network fees. Payments sent on the wrong network, in the wrong token or to the wrong address cannot be recovered. We never ask for private keys or seed phrases.</p>
      <h2>Acceptable use</h2><p>Don’t use Tokenscope to defame projects, to misrepresent scores as audits, or to break the law. Rate limits apply to all plans.</p>
      <h2>Liability</h2><p>The service is provided “as is” without warranties. To the extent permitted by law, our total liability is limited to the amount you paid in the 30 days before the claim.</p>
      <h2>Contact</h2><p>${CONTACT}.</p>`],
    privacy: ['Privacy Policy', `
      <p>We collect as little as possible.</p>
      <h2>Website scans</h2><p>Scans on this website run in your browser and call DexScreener and GoPlus directly, so those providers see your IP address and the token you look up. Your free-scan counter is stored in your browser’s localStorage.</p>
      <h2>Paid accounts</h2><p>If you buy a plan we store your email address (for magic-link login, your API key and expiry reminders), your invoices, the paying wallet address and transaction hash, and API usage counts. Payment records are kept for accounting and tax purposes.</p>
      <h2>Alerts</h2><p>If you connect Telegram or Discord we store the chat ID or webhook URL needed to deliver alerts. You can remove it at any time.</p>
      <h2>Processors</h2><p>Cloudflare (hosting, database, analytics without cookies), Resend (email), Telegram and Discord (alerts). We don’t sell data and don’t use advertising trackers.</p>
      <h2>Your rights</h2><p>You can ask for a copy or deletion of your data via ${CONTACT}. Blockchain transactions are public and cannot be deleted by anyone.</p>`],
    refunds: ['Refund Policy', `
      <div class="notice warn">${esc(REFUND_RULE)}</div>
      <h2>When we refund</h2><ul><li>Within <b>7 days of purchase</b>, and</li><li>only if the <b>service was down</b> (the API, MCP server or website was unavailable) in a way that stopped you using what you paid for.</li></ul>
      <h2>How refunds work</h2><p>Refunds are manual. Open a request via ${CONTACT} with your invoice ID and paying transaction hash. Approved refunds are sent in USDC to the paying address on the same network, minus network fees.</p>
      <h2>What we can’t refund</h2><ul><li>Change of mind after purchase, or unused time/credits.</li><li>Payments sent to the wrong address, on the wrong network, in the wrong token or with the wrong amount (we’ll try to help, but crypto transfers can’t be reversed).</li><li>Disagreement with a risk score.</li></ul>`],
  } as const;
  const [title, body] = pages[page];
  setMeta(`${title} · Tokenscope`);
  root.innerHTML = layout(`<div class="prose"><h1 style="font-size:38px">${title}</h1><p class="dim small">Last updated ${updated}</p>${body}</div>`);
}

export function notFoundView(root: HTMLElement) {
  setMeta('Not found · Tokenscope');
  root.innerHTML = layout(`<div class="card stack" style="text-align:center"><h1>404</h1><p class="muted">That page doesn’t exist.</p><div><a class="btn" href="${href('/')}" data-link>Scan a token</a></div></div>`);
}
