import type { Env } from './env';

/** Send email via Resend. No-op (logged) if RESEND_API_KEY is not configured. */
export async function sendEmail(env: Env, to: string, subject: string, text: string): Promise<boolean> {
  if (!env.RESEND_API_KEY) { console.log(`[email disabled] to=${to} subject=${subject}`); return false; }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: env.EMAIL_FROM, to: [to], subject, text }),
  });
  if (!res.ok) console.error('resend error', res.status, await res.text());
  return res.ok;
}
