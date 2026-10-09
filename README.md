# Tokenscope

**Instant token risk scans for people and AI agents.** Free website for traffic, paid API/MCP for revenue. Crypto payments only (USDC on Ethereum and Solana).

**Live site (GitHub Pages):** https://roningrk1.github.io/Tokenscope-App/

> Scores are automated signals, not financial advice and not an audit.

This repo has two parts:

| Part | Folder | Runs on | Status |
|---|---|---|---|
| Website + in-browser scanner | `site/` + `shared/` | GitHub Pages (static) | **Live** |
| Backend: scanner API, MCP server, API keys + limits, checkout, payment matchers, alerts, magic-link login | `worker/` + `shared/` | Cloudflare Workers + D1 + KV + Cron | **Live** at https://tokenscope.jazzforbesbrowne48.workers.dev |

`shared/` is used by both: the risk scoring engine (`risk.ts`), data fetchers (`data.ts`), chains and the payment addresses (`config.ts`), plans/prices/billing rules (`pricing.ts`), Solana Pay / EIP-681 helpers (`payments.ts`).

## What works on GitHub Pages

GitHub Pages is static, so the site does everything in the browser:

- **Real risk scans** on Ethereum, Solana, Base, BNB Chain, Arbitrum, Polygon. The browser calls DexScreener (pairs, liquidity, price, launches) and GoPlus Security (honeypot, taxes, owner powers, mint/freeze authority, holders) directly. Both send CORS headers.
- Search by name/symbol or paste an address (chain auto-detected).
- **Compare** up to 4 tokens, **New launches** feed with one-click quick checks.
- Shareable **`/is/<token>-safe`** pages: pre-rendered for popular tokens (`/is/usdc-safe`, `/is/bonk-safe`, ...) plus any address (`/is/<address>-safe`) via the `404.html` SPA fallback. `sitemap.xml` and `robots.txt` are generated.
- **Pricing** (exact plans, prices, credit packs, billing and refund rules) and **Checkout** that shows the receiving address, exact USDC amount, Solana Pay link + QR (unique reference per invoice) and the Ethereum unique-cents-suffix amount + EIP-681 link. Defaults to Solana; nudges 90/365-day plans on Ethereum.
- Terms, Privacy and Refund policy pages; disclaimer on every page.
- Free tier: a soft 25 scans/day counter in the browser.

**What the static site can't do:** record invoices, verify payments, activate plans, issue API keys, enforce limits, run alerts. Until the Worker is live, checkout runs in **preview mode** with a clear "do not send funds yet" banner. Once you deploy the Worker and set the `VITE_API_BASE` repository variable, checkout creates real invoices through the backend (and refuses to display any address that doesn't match `shared/config.ts`).

## Safety checks (`npm test`, run in CI before every deploy)

- Receiving addresses and USDC contract/mint match `docs/BUILD_SPEC.md` **character by character**.
- Ethereum addresses have valid EIP-55 checksums; Solana addresses decode to 32 bytes.
- Plan prices and credit packs match the spec table.
- Ethereum unique amount, EIP-681 and Solana Pay links, period stacking and upgrade proration.

| | Address |
|---|---|
| Ethereum USDC receiving | `0xeeb8269Df3767b4889414161F89B7a63Cdf2B50c` |
| Solana USDC receiving | `2Hn8PPimz48DmbHj8Ap6QsUFT2CXzwq6fQxWH9zJHve7` |
| USDC (Ethereum) | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` |
| USDC (Solana mint) | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` |

Only public receiving addresses exist anywhere in this project. No private keys, ever.

## Local development

```bash
npm install
npm run dev        # http://localhost:5173/Tokenscope-App/
npm test           # pre-launch checks
npm run smoke      # live scans of USDC/PEPE/BONK etc. through the same code the site uses
npm run build      # -> dist/
```

## Risk scoring

Each check emits a finding `{severity, title, detail, source}`. Weights: critical 45, high 22, medium 10, low 4; positive signals subtract a little but can offset at most 30% of the risk weight, so they never hide a red flag. Any critical finding forces **high risk**. Levels: 0–14 low, 15–44 moderate, 45+ high. Tokens on GoPlus's trusted list (e.g. USDC) have issuer controls (mint, freeze, proxy) reported as info, not risk. Wording is always "high risk" with evidence. The engine never calls a token a scam.

## Live backend

- Worker: https://tokenscope.jazzforbesbrowne48.workers.dev (`/api/health`, `/api/v1/scan`, `/mcp`, ...)
- D1 `tokenscope` and KV `tokenscope-cache` (IDs in `worker/wrangler.toml`), migrations applied, 3 cron triggers active.
- GitHub Actions variable `VITE_API_BASE` points the site's checkout at the Worker (live mode).
- Wrangler 4 needs Node 22+.
- Optional secrets still to add: `RESEND_API_KEY` (magic-link + receipts), `TELEGRAM_BOT_TOKEN` (bot + alerts), `GOPLUS_APP_KEY`/`GOPLUS_APP_SECRET` (GoPlus rate limits from shared Cloudflare IPs).

## Deploying the Worker to Cloudflare

```bash
cd worker
npm install
npx wrangler login
npx wrangler d1 create tokenscope          # paste database_id into wrangler.toml
npx wrangler kv namespace create CACHE     # paste id into wrangler.toml
npm run db:migrate                         # applies migrations/0001_init.sql
npx wrangler secret put RESEND_API_KEY     # magic-link + receipts (optional at first)
npx wrangler secret put TELEGRAM_BOT_TOKEN # optional
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
npx wrangler secret put ADMIN_TOKEN        # for /api/admin/payments.csv
npm run deploy
```

Then:
1. Set `APP_URL` / `ALLOWED_ORIGINS` in `wrangler.toml` to your site's URL(s).
2. In GitHub → Settings → Secrets and variables → Actions → **Variables**, add `VITE_API_BASE` = your Worker URL (e.g. `https://tokenscope.<you>.workers.dev`) and re-run the Pages workflow. Checkout switches from preview to live.
3. Telegram: `curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=<WORKER>/api/telegram/webhook&secret_token=<SECRET>"`.
4. Optionally move the site to Cloudflare Pages (`npm run build` with `BASE_PATH=/`) for `tokenscope.pages.dev`, and route `/api/*` + `/mcp` to the Worker.
5. **Before going live:** send a small test payment on each chain and check the invoice turns `paid`; re-check both addresses character by character.

### Backend endpoints

| Endpoint | Notes |
|---|---|
| `GET /api/v1/scan?chain=&address=` | Free 50/day per IP without a key |
| `GET /api/v1/token`, `/api/v1/compare?tokens=c:a,c:a`, `/api/v1/launches` | Key required (Builder plan or credits) |
| `GET/POST/DELETE /api/v1/watches` | Pro 10, Builder 10, Alerts Team 100; Telegram/Discord/email |
| `POST /mcp` | MCP Streamable HTTP: `scan_token`, `get_token_info`, `compare_tokens`, `new_launches`, `watch_address` |
| `POST /api/checkout/invoices`, `GET /api/checkout/invoices/:id`, `POST .../:id/tx` | 30-min invoices; Solana Pay reference; Ethereum unique amount; tx-hash speed-up |
| `POST /api/auth/magic-link`, `GET /api/auth/verify` | Resend email, HttpOnly session cookie |
| `GET /api/account`, `POST /api/account/keys`, `POST /api/account/telegram-link` | Account, key rotation, Telegram linking |
| `POST /api/telegram/webhook` | `/scan`, `/watch`, `/start <code>` |
| `GET /api/admin/payments.csv` | Payment ledger export (UK: crypto received for services is income, so record every payment) |

**Crons:** every minute: expire invoices, match Solana references (finalized) and Ethereum USDC `Transfer` logs (12 confirmations); every 10 minutes: watch/alert worker; daily: expiry reminders (email + Telegram).

**Billing logic:** prepaid only; same-plan renewals stack onto the current expiry; plan changes are prorated by remaining days; credits never expire; API keys stored as SHA-256 hashes, shown once.

## Data sources

DexScreener and GoPlus Security public APIs (free, no key). The spec also lists DefiLlama, CoinGecko (demo key) and public RPCs. The Worker uses public RPCs for payment matching; DefiLlama/CoinGecko enrichment is a later addition.
