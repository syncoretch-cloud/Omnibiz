// Email & SMS delivery. Messages are written to the outbox table; in development they are also printed
// to the console and visible at /api/dev/outbox. A production worker would relay them through an
// email provider (SES, SendGrid, Postmark) and an SMS gateway (Africa's Talking, Twilio, Beem).
import { run } from '../db/index.ts';
import { config } from '../config.ts';

export function sendEmail(to: string, subject: string, body: string) {
  run('INSERT INTO outbox (channel, recipient, subject, body) VALUES (?,?,?,?)', 'email', to, subject, body);
  if (!config.isProd && process.env.NODE_ENV !== 'test') console.log(`\n✉️  [email → ${to}] ${subject}\n   ${body}\n`);
}

export function sendSms(to: string, body: string) {
  run('INSERT INTO outbox (channel, recipient, subject, body) VALUES (?,?,?,?)', 'sms', to, null, body);
  if (!config.isProd && process.env.NODE_ENV !== 'test') console.log(`\n📱 [sms → ${to}] ${body}\n`);
}
