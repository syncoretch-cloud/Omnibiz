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

const env = process.env.NODE_ENV ?? 'development';

export const config = {
  env,
  isProd: env === 'production',
  port: Number(process.env.PORT ?? 4000),
  dataDir,
  dbPath: process.env.DB_PATH ?? path.join(dataDir, 'omnibiz.db'),
  uploadDir: process.env.UPLOAD_DIR ?? path.join(dataDir, 'uploads'),
  webDist: path.resolve(SERVER_ROOT, '..', 'web', 'dist'),
  secret: loadSecret(),
  sessionDays: 30,
  /** Minimum job-match score (0-100) before a user is notified about a new vacancy. */
  jobNotifyThreshold: 55,
  maxUploadBytes: 25 * 1024 * 1024,
  /** Email/phone code verification at sign-up. Off for now; set CONTACT_VERIFICATION=on to bring it back. */
  contactVerification: process.env.CONTACT_VERIFICATION === 'on',
};
