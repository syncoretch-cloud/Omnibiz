// Email and SMS delivery. Every message is written to the outbox table first (so nothing is lost and development
// needs no provider), then handed to a real provider when one is configured:
//   email: SMTP (SMTP_HOST, SMTP_USER, SMTP_PASS, MAIL_FROM)
//   SMS:   Africa's Talking (SMS_PROVIDER=africastalking, AT_USERNAME, AT_API_KEY) or Twilio (SMS_PROVIDER=twilio, …)
// Delivery runs in the background; the outbox row records `sent` or `failed` with the reason.
import nodemailer from 'nodemailer';
import { run } from '../db/index.ts';
import { config } from '../config.ts';

export type EmailSender = (to: string, subject: string, body: string) => Promise<void>;
export type SmsSender = (to: string, body: string) => Promise<void>;

let mailer: nodemailer.Transporter | null = null;
const smtpSender: EmailSender | null = config.mail.host
  ? async (to, subject, body) => {
      mailer ??= nodemailer.createTransport({
        host: config.mail.host, port: config.mail.port, secure: config.mail.secure,
        auth: config.mail.user ? { user: config.mail.user, pass: config.mail.pass } : undefined,
      });
      await mailer.sendMail({ from: config.mail.from, to, subject, text: body });
    }
  : null;

async function okOrThrow(res: Response, what: string) {
  if (!res.ok) throw new Error(`${what} answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res;
}

const africasTalking: SmsSender | null = config.sms.provider === 'africastalking' && config.sms.atUsername && config.sms.atApiKey
  ? async (to, body) => {
      const host = config.sms.atUsername === 'sandbox' ? 'api.sandbox.africastalking.com' : 'api.africastalking.com';
      const form = new URLSearchParams({ username: config.sms.atUsername, to, message: body });
      if (config.sms.atSender) form.set('from', config.sms.atSender);
      const res = await okOrThrow(await fetch(`https://${host}/version1/messaging`, {
        method: 'POST', headers: { apiKey: config.sms.atApiKey, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body: form,
      }), "Africa's Talking");
      const j = (await res.json()) as { SMSMessageData?: { Recipients?: { status: string }[] } };
      const status = j.SMSMessageData?.Recipients?.[0]?.status;
      if (status && status !== 'Success') throw new Error(`Africa's Talking: ${status}`);
    }
  : null;

const twilio: SmsSender | null = config.sms.provider === 'twilio' && config.sms.twilioSid && config.sms.twilioToken && config.sms.twilioFrom
  ? async (to, body) => {
      const auth = Buffer.from(`${config.sms.twilioSid}:${config.sms.twilioToken}`).toString('base64');
      await okOrThrow(await fetch(`https://api.twilio.com/2010-04-01/Accounts/${config.sms.twilioSid}/Messages.json`, {
        method: 'POST', headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ To: to, From: config.sms.twilioFrom, Body: body }),
      }), 'Twilio');
    }
  : null;

let emailSender: EmailSender | null = smtpSender;
let smsSender: SmsSender | null = africasTalking ?? twilio;

/** Tests swap in fakes; pass null to turn a channel back off. */
export function setSenders(s: { email?: EmailSender | null; sms?: SmsSender | null }) {
  if ('email' in s) emailSender = s.email ?? null;
  if ('sms' in s) smsSender = s.sms ?? null;
}

export const deliveryConfigured = () => ({ email: !!emailSender, sms: !!smsSender });

function deliver(id: number, send: (() => Promise<void>) | null) {
  if (!send) return;
  send().then(
    () => run("UPDATE outbox SET status = 'sent' WHERE id = ?", id),
    (e: Error) => {
      run("UPDATE outbox SET status = 'failed', error = ? WHERE id = ?", String(e.message).slice(0, 300), id);
      console.error(`[outbox] delivery ${id} failed: ${e.message}`);
    },
  );
}

export function sendEmail(to: string, subject: string, body: string) {
  const { id } = run('INSERT INTO outbox (channel, recipient, subject, body) VALUES (?,?,?,?)', 'email', to, subject, body);
  if (!config.isProd && process.env.NODE_ENV !== 'test') console.log(`\n✉️  [email → ${to}] ${subject}\n   ${body}\n`);
  deliver(id, emailSender && (() => emailSender!(to, subject, body)));
}

export function sendSms(to: string, body: string) {
  const { id } = run('INSERT INTO outbox (channel, recipient, subject, body) VALUES (?,?,?,?)', 'sms', to, null, body);
  if (!config.isProd && process.env.NODE_ENV !== 'test') console.log(`\n📱 [sms → ${to}] ${body}\n`);
  deliver(id, smsSender && (() => smsSender!(to, body)));
}
