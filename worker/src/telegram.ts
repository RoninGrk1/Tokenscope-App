import type { Env } from './env';
import { HttpError, randomId } from './util';
import { telegramSend } from './alerts';
import { cachedScan, parseToken } from './scanner';
import { activeSubscription, type User } from './auth';
import { addWatch } from './watches';
import { DISCLAIMER } from '../../shared/config';

/** Account page calls this; user then sends `/start <code>` to the bot to link their chat. */
export async function createTelegramLinkCode(env: Env, user: User): Promise<string> {
  const code = randomId('', 6);
  await env.CACHE.put(`tglink:${code}`, user.id, { expirationTtl: 600 });
  return code;
}

export async function telegramWebhook(env: Env, req: Request): Promise<Response> {
  if (!env.TELEGRAM_WEBHOOK_SECRET || req.headers.get('x-telegram-bot-api-secret-token') !== env.TELEGRAM_WEBHOOK_SECRET) throw new HttpError(401, 'bad secret');
  const update = (await req.json()) as any;
  const msg = update.message; if (!msg?.text) return new Response('ok');
  const chatId = String(msg.chat.id);
  const [cmd, ...args] = String(msg.text).trim().split(/\s+/);
  const user = await env.DB.prepare('SELECT * FROM users WHERE telegram_chat_id = ?').bind(chatId).first<User>();
  const reply = (t: string) => telegramSend(env, chatId, t);

  switch (cmd.split('@')[0]) {
    case '/start': {
      if (args[0]) {
        const uid = await env.CACHE.get(`tglink:${args[0]}`);
        if (!uid) { await reply('That link code has expired. Generate a new one from your Tokenscope account page.'); break; }
        await env.DB.prepare('UPDATE users SET telegram_chat_id = ? WHERE id = ?').bind(chatId, uid).run();
        await env.CACHE.delete(`tglink:${args[0]}`);
        await reply('Linked! You will get watch alerts and plan reminders here.');
      } else await reply('Tokenscope bot\n/scan <chain> <address> – risk scan\n/watch <chain> <address> – alert on risk changes (paid plans)\n\nChains: ethereum, solana, base, bsc, arbitrum, polygon');
      break;
    }
    case '/scan': {
      try {
        const { chain, address } = args.length >= 2 ? parseToken(args[0], args[1]) : parseToken('', args[0]);
        const r = await cachedScan(env, chain, address);
        const red = r.findings.filter((f) => ['critical', 'high', 'medium'].includes(f.severity)).slice(0, 5).map((f) => `• ${f.title}`).join('\n');
        await reply(`<b>${r.symbol}</b> on ${r.chainName}: ${r.level.toUpperCase()} risk (${r.score}/100)\n${r.verdict}\n${red}\n${env.APP_URL}/scan/${chain}/${address}\n\n<i>${DISCLAIMER}</i>`);
      } catch (e) { await reply(`Usage: /scan <chain> <address>\n${(e as Error).message}`); }
      break;
    }
    case '/watch': {
      if (!user) { await reply('Link your account first: open your Tokenscope account page and use “Connect Telegram”.'); break; }
      try {
        const w = await addWatch(env, user, await activeSubscription(env, user.id), { chain: args[0], address: args[1], channel: 'telegram', target: chatId });
        await reply(`Watching ${w.address} on ${w.chain}. Current: ${w.current.level} (${w.current.score}).`);
      } catch (e) { await reply((e as Error).message); }
      break;
    }
    default: await reply('Unknown command. Try /scan <chain> <address>');
  }
  return new Response('ok');
}
