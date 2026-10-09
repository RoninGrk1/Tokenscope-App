import type { Env } from './env';
import { cachedScan } from './scanner';
import { now } from './util';
import { sendEmail } from './email';
import { PLANS } from '../../shared/pricing';
import { DISCLAIMER, type ChainKey } from '../../shared/config';
import type { RiskReport } from '../../shared/risk';

interface WatchRow { id: string; user_id: string; chain: ChainKey; address: string; channel: 'telegram' | 'discord' | 'email'; target: string; last_score: number | null; last_level: string | null }

export async function telegramSend(env: Env, chatId: string, text: string) {
  if (!env.TELEGRAM_BOT_TOKEN) { console.log('[telegram disabled]', chatId, text); return; }
  const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
  });
  if (!r.ok) console.error('telegram', r.status, await r.text());
}

export async function discordSend(webhook: string, content: string) {
  if (!/^https:\/\/(discord|discordapp)\.com\/api\/webhooks\//.test(webhook)) throw new Error('Invalid Discord webhook URL');
  const r = await fetch(webhook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content, allowed_mentions: { parse: [] } }) });
  if (!r.ok) console.error('discord', r.status);
}

export function alertText(r: RiskReport, prev: { score: number | null; level: string | null }, appUrl: string): string {
  const top = r.findings.filter((f) => ['critical', 'high', 'medium'].includes(f.severity)).slice(0, 4).map((f) => `• ${f.title}`).join('\n');
  return `Tokenscope alert: ${r.symbol} on ${r.chainName}\nRisk ${prev.level ?? '?'} (${prev.score ?? '?'}) → ${r.level} (${r.score})\n${r.verdict}\n${top}\n${appUrl}/scan/${r.chain}/${r.address}\n\n${DISCLAIMER}`;
}

async function deliver(env: Env, w: WatchRow, text: string) {
  if (w.channel === 'telegram') await telegramSend(env, w.target, text);
  else if (w.channel === 'discord') await discordSend(w.target, text);
  else await sendEmail(env, w.target, 'Tokenscope risk alert', text);
}

/** Alert worker: re-scan the least recently checked watches; alert on level change or a big score move. */
export async function runWatchWorker(env: Env, batch = 40) {
  const { results } = await env.DB.prepare(`SELECT w.* FROM watches w JOIN subscriptions s ON s.user_id = w.user_id
    WHERE s.expires_at > ? ORDER BY COALESCE(w.last_checked_at, 0) ASC LIMIT ?`).bind(now(), batch).all<WatchRow>();
  for (const w of results) {
    try {
      const r = await cachedScan(env, w.chain, w.address);
      const changed = w.last_level != null && (r.level !== w.last_level || Math.abs(r.score - (w.last_score ?? r.score)) >= 15);
      if (changed) await deliver(env, w, alertText(r, { score: w.last_score, level: w.last_level }, env.APP_URL));
      await env.DB.prepare('UPDATE watches SET last_score = ?, last_level = ?, last_checked_at = ? WHERE id = ?').bind(r.score, r.level, now(), w.id).run();
    } catch (e) { console.error('watch', w.id, e); }
  }
}

/** Daily: remind users a few days before their prepaid period ends (no auto-renew). */
export async function runExpiryReminders(env: Env, daysBefore = 3) {
  const t = now();
  const { results } = await env.DB.prepare(`SELECT s.*, u.email, u.telegram_chat_id FROM subscriptions s JOIN users u ON u.id = s.user_id
    WHERE s.expires_at > ? AND s.expires_at < ? AND s.reminder_sent_at IS NULL`).bind(t, t + daysBefore * 86_400_000).all<any>();
  for (const s of results) {
    const msg = `Your Tokenscope ${PLANS[s.plan as keyof typeof PLANS].name} plan ends on ${new Date(s.expires_at).toUTCString()}. Plans don't auto-renew. Renew any time and the new period is added to the end of the current one: ${env.APP_URL}/pricing`;
    if (s.email) await sendEmail(env, s.email, 'Your Tokenscope plan ends soon', msg);
    if (s.telegram_chat_id) await telegramSend(env, s.telegram_chat_id, msg);
    await env.DB.prepare('UPDATE subscriptions SET reminder_sent_at = ? WHERE user_id = ?').bind(t, s.user_id).run();
  }
}
