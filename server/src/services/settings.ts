import { get, run } from '../db/index.ts';

export function getSetting(key: string, fallback: string): string {
  return get('SELECT value FROM app_settings WHERE key = ?', key)?.value ?? fallback;
}

export function setSetting(key: string, value: string) {
  run('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value);
}
