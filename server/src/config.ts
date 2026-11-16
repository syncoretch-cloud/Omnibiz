import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const SERVER_ROOT = path.resolve(import.meta.dirname, '..');
const dataDir = process.env.DATA_DIR ?? path.join(SERVER_ROOT, 'data');

function loadSecret(): Buffer {
  const fromEnv = process.env.OMNIBIZ_SECRET;
  if (fromEnv && /^[0-9a-f]{64}$/i.test(fromEnv)) return Buffer.from(fromEnv, 'hex');
  const file = path.join(dataDir, 'secret.key');
  fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  return Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'hex');
}

// Settings (SMTP and SMS credentials, ports) can live in server/.env or a .env at the project root; real environment variables win.
for (const file of [path.join(SERVER_ROOT, '.env'), path.join(SERVER_ROOT, '..', '.env')]) {
  if (fs.existsSync(file) && typeof process.loadEnvFile === 'function') process.loadEnvFile(file);
}

const env = process.env.NODE_ENV ?? 'development';

export const config = {
  env,
  isProd: env === 'production',
  port: Number(process.env.PORT ?? 4000),
  dataDir,
  dbPath: process.env.DB_PATH ?? path.join(dataDir, 'omnibiz.db'),
  uploadDir: process.env.UPLOAD_DIR ?? path.join(dataDir, 'uploads'),
  webDist: path.resolve(SERVER_ROOT, '..', 'web', 'dist'),
  /** OmniBiz Manager (the staff app), served on its own port when it has been built. 0 turns it off. */
  adminDist: path.resolve(SERVER_ROOT, '..', 'admin', 'dist'),
  managerPort: Number(process.env.MANAGER_PORT ?? 4001),
  secret: loadSecret(),
  sessionDays: 30,
  /** Minimum job-match score (0-100) before a user is notified about a new vacancy. */
  jobNotifyThreshold: 55,
  maxUploadBytes: 25 * 1024 * 1024,
  /** Email/phone code verification at sign-up. Off for now; set CONTACT_VERIFICATION=on to bring it back. */
  contactVerification: process.env.CONTACT_VERIFICATION === 'on',
  /** Email delivery over SMTP (Gmail, Zoho, Brevo, SES…). Unset = messages are only saved to the outbox. */
  mail: {
    host: process.env.SMTP_HOST ?? '',
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === 'true' || process.env.SMTP_PORT === '465',
    user: process.env.SMTP_USER ?? '',
    pass: process.env.SMTP_PASS ?? '',
    from: process.env.MAIL_FROM ?? process.env.SMTP_USER ?? 'OmniBiz <no-reply@omnibiz.local>',
  },
  /** Text messages through Africa's Talking or Twilio. Unset = messages are only saved to the outbox. */
  sms: {
    provider: (process.env.SMS_PROVIDER ?? '').toLowerCase(),
    atUsername: process.env.AT_USERNAME ?? '',
    atApiKey: process.env.AT_API_KEY ?? '',
    atSender: process.env.AT_SENDER_ID ?? '',
    twilioSid: process.env.TWILIO_ACCOUNT_SID ?? '',
    twilioToken: process.env.TWILIO_AUTH_TOKEN ?? '',
    twilioFrom: process.env.TWILIO_FROM ?? '',
  },
};
