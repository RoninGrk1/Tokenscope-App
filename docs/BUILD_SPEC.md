# Tokenscope: Build Outline

**Instant token risk scans for people and AI agents.**
Free website for traffic, paid API/MCP for revenue. Crypto payments only (USDC on Ethereum and Solana).

---

## 1. Tech Stack ($0 to start)

| Layer | Service |
|---|---|
| Frontend + API + MCP | Cloudflare Pages + Workers (TypeScript, one project) |
| Database | Cloudflare D1 |
| Cache | Cloudflare KV + edge cache |
| Cron | Workers Cron Triggers |
| Auth + email | Magic-link login, Resend free tier |
| Alerts | Telegram Bot API, Discord webhooks |
| Data | DexScreener, GoPlus, DefiLlama, CoinGecko demo key, public RPCs |
| Repo + analytics | GitHub, Cloudflare Web Analytics |
| Domain | Free `tokenscope.pages.dev` |

---

## 2. Build Components

1. Risk scoring engine
2. Scanner API + website
3. `/is/[token]-safe` SEO pages + sitemap
4. MCP server (`tokenscope-mcp`)
   - `scan_token`
   - `get_token_info`
   - `compare_tokens`
   - `new_launches`
   - `watch_address`
5. API keys + usage limits
6. Telegram bot + alert worker
7. Crypto checkout (invoices, Solana Pay, Ethereum matcher, confirmation cron)

---

## 3. Payments (crypto only)

### Accepted
| Chain | Asset | Receiving address |
|---|---|---|
| Ethereum | USDC (ERC-20) | `0xeeb8269Df3767b4889414161F89B7a63Cdf2B50c` |
| Solana | USDC (SPL) | `2Hn8PPimz48DmbHj8Ap6QsUFT2CXzwq6fQxWH9zJHve7` |

USDC contract / mint (verify against Circle's official list before deploying):
- Ethereum: `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`
- Solana: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`

### Flow (no processor, no custody)
1. User picks a plan, period, and chain.
2. Checkout creates an invoice in D1 with a 30-minute expiry.
3. **Solana:** Solana Pay transfer request with a unique reference key per invoice. The Worker finds the payment via the reference and checks mint, recipient, and amount.
4. **Ethereum:** unique cents suffix per invoice (e.g. $79.0417) since there is no memo field. A cron watches USDC `Transfer` events to your address and matches the exact amount. The user can also paste a tx hash to speed up verification.
5. Wait for confirmations (Solana: finalized; Ethereum: ~12 blocks), then activate the plan and issue an API key.
6. Only public receiving addresses live on the server (env vars). No private keys, ever.

---

## 4. Pricing (USDC)

| Plan | 30 days | 90 days (~10% off) | 365 days (~20% off) |
|---|---|---|---|
| **Pro** | $29 | $79 | $279 |
| **Builder (API + MCP)** | $79 | $213 | $759 |
| **Alerts Team** | $49 | $132 | $470 |

### Plan contents
- **Free:** website scans, low daily limit
- **Pro:** unlimited site scans, compare, 10 watches
- **Builder:** API + MCP access, 50k calls per period, new launches feed
- **Alerts Team:** 100 watches, Telegram and Discord team alerts

### Pay-per-call credits (for agents, no subscription)
| Pack | Calls |
|---|---|
| $10 | 5,000 |
| $25 | 15,000 |
| $50 | 35,000 |

Credits don't expire.

### Billing rules
- Prepaid periods only, no auto-renew (crypto can't pull payments).
- Paying again before expiry adds the new period to the end of the current one.
- Mid-period upgrades are prorated by remaining days.
- Reminder by email or Telegram a few days before expiry.
- Refunds are manual, only within 7 days of purchase and only if the service was down. State this clearly on the pricing page, since crypto payments can't be reversed.

---

## 5. Fees

| Item | Cost |
|---|---|
| Payment processor | $0 |
| Network gas | Paid by the customer |
| Cloudflare, GitHub, Telegram, Discord, free data APIs | $0 |
| Cloudflare Workers paid plan | ~$5/mo, only if limits are hit |
| Resend | ~$20/mo, only if free quota is outgrown |
| Custom domain (optional) | ~$10-40/year |

Ethereum USDC gas can be a few dollars. Default checkout to Solana, and on the Ethereum checkout suggest the 90 or 365 day plans so gas is a smaller share of the payment.

---

## 6. Pre-Launch Checks

- Send a small test payment on each chain to confirm the matcher works.
- Check both receiving addresses character by character before going live. A typo is unrecoverable.
- Add disclaimer on every page: scores are automated signals, not financial advice and not an audit.
- Use "high risk" wording backed by evidence rather than calling a token a scam as fact.
- Add terms, privacy policy, and refund policy pages.
- In the UK, crypto received for services counts as income, so record every payment.
