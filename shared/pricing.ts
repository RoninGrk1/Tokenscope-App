/** Plans, prices, credit packs and billing rules (USDC). Single source of truth. */

export type PlanId = 'pro' | 'builder' | 'alerts';
export type PeriodDays = 30 | 90 | 365;

export interface Plan {
  id: PlanId;
  name: string;
  tagline: string;
  prices: Record<PeriodDays, number>;
  features: string[];
  limits: { siteScansPerDay: number | null; apiCallsPerPeriod: number; watches: number; compare: boolean; launches: boolean; teamAlerts: boolean; mcp: boolean };
}

export const FREE_LIMITS = { siteScansPerDay: 25, apiCallsPerDay: 50, watches: 0 } as const;

export const PLANS: Record<PlanId, Plan> = {
  pro: {
    id: 'pro',
    name: 'Pro',
    tagline: 'For active traders',
    prices: { 30: 29, 90: 79, 365: 279 },
    features: ['Unlimited site scans', 'Compare tokens', '10 watches'],
    limits: { siteScansPerDay: null, apiCallsPerPeriod: 0, watches: 10, compare: true, launches: false, teamAlerts: false, mcp: false },
  },
  builder: {
    id: 'builder',
    name: 'Builder (API + MCP)',
    tagline: 'For bots, apps and AI agents',
    prices: { 30: 79, 90: 213, 365: 759 },
    features: ['API + MCP access', '50k calls per period', 'New launches feed'],
    limits: { siteScansPerDay: null, apiCallsPerPeriod: 50_000, watches: 10, compare: true, launches: true, teamAlerts: false, mcp: true },
  },
  alerts: {
    id: 'alerts',
    name: 'Alerts Team',
    tagline: 'For communities and desks',
    prices: { 30: 49, 90: 132, 365: 470 },
    features: ['100 watches', 'Telegram and Discord team alerts'],
    limits: { siteScansPerDay: null, apiCallsPerPeriod: 0, watches: 100, compare: true, launches: false, teamAlerts: true, mcp: false },
  },
};

export const PLAN_LIST: Plan[] = [PLANS.pro, PLANS.builder, PLANS.alerts];
export const PERIODS: PeriodDays[] = [30, 90, 365];
export const PERIOD_LABEL: Record<PeriodDays, string> = { 30: '30 days', 90: '90 days (~10% off)', 365: '365 days (~20% off)' };

export interface CreditPack { id: string; price: number; calls: number }
export const CREDIT_PACKS: CreditPack[] = [
  { id: 'credits-10', price: 10, calls: 5_000 },
  { id: 'credits-25', price: 25, calls: 15_000 },
  { id: 'credits-50', price: 50, calls: 35_000 },
];

export const BILLING_RULES: string[] = [
  'Prepaid periods only, no auto-renew (crypto can\u2019t pull payments).',
  'Paying again before expiry adds the new period to the end of the current one.',
  'Mid-period upgrades are prorated by remaining days.',
  'We send a reminder by email or Telegram a few days before expiry.',
  'Pay-per-call credits don\u2019t expire.',
];

export const REFUND_RULE =
  'Refunds are manual, only within 7 days of purchase and only if the service was down. Crypto payments can\u2019t be reversed, so please check your plan before paying.';

export const INVOICE_TTL_MINUTES = 30;
export const DAY_MS = 86_400_000;

/** Paying before expiry stacks: the new period starts when the current one ends. */
export function stackExpiry(currentExpiresAt: number | null, now: number, days: number): number {
  const start = currentExpiresAt && currentExpiresAt > now ? currentExpiresAt : now;
  return start + days * DAY_MS;
}

/**
 * Mid-period upgrade proration: unused value of the current plan (by remaining days,
 * at its own daily rate) is credited against the new purchase. Returns USD, >= 0, 2dp.
 */
export function proratedUpgradePrice(opts: {
  currentPaid: number; currentDays: number; currentExpiresAt: number; now: number; newPrice: number;
}): { credit: number; due: number; remainingDays: number } {
  const remainingDays = Math.max(0, Math.floor((opts.currentExpiresAt - opts.now) / DAY_MS));
  const credit = Math.round((opts.currentPaid / opts.currentDays) * remainingDays * 100) / 100;
  const due = Math.max(0, Math.round((opts.newPrice - credit) * 100) / 100);
  return { credit: Math.min(credit, opts.newPrice), due, remainingDays };
}

/**
 * Ethereum has no memo field, so each invoice gets a unique 4-decimal cents suffix
 * (e.g. $79.0417). Returns the display amount and the exact USDC base units (6dp).
 */
export function ethUniqueAmount(base: number, suffix: number): { display: string; units: bigint } {
  if (!Number.isInteger(suffix) || suffix < 1 || suffix > 9999) throw new Error('suffix must be 1..9999');
  const units = BigInt(Math.round(base * 100)) * 10_000n + BigInt(suffix) * 100n;
  return { display: formatUnits(units, 6, 4), units };
}

export function toUnits(amount: number, decimals = 6): bigint {
  return BigInt(Math.round(amount * 10 ** Math.min(decimals, 6))) * 10n ** BigInt(Math.max(0, decimals - 6));
}

export function formatUnits(units: bigint, decimals = 6, minFrac = 2): string {
  const neg = units < 0n; const u = neg ? -units : units;
  const base = 10n ** BigInt(decimals);
  const whole = u / base; let frac = (u % base).toString().padStart(decimals, '0');
  frac = frac.replace(/0+$/, ''); if (frac.length < minFrac) frac = frac.padEnd(minFrac, '0');
  return `${neg ? '-' : ''}${whole}${frac ? '.' + frac : ''}`;
}

export type ProductRef = { kind: 'plan'; plan: PlanId; days: PeriodDays } | { kind: 'credits'; pack: string };

export function productPrice(p: ProductRef): number {
  if (p.kind === 'plan') return PLANS[p.plan].prices[p.days];
  const pack = CREDIT_PACKS.find((c) => c.id === p.pack);
  if (!pack) throw new Error('unknown credit pack');
  return pack.price;
}

export function productLabel(p: ProductRef): string {
  if (p.kind === 'plan') return `${PLANS[p.plan].name} \u00b7 ${p.days} days`;
  const pack = CREDIT_PACKS.find((c) => c.id === p.pack)!;
  return `${pack.calls.toLocaleString('en-US')} API calls (credits)`;
}
