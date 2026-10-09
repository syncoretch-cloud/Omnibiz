// Data-access layer. Every module talks to the database through these helpers, which keeps
// the SQL portable and makes a later move to PostgreSQL (or read replicas) a contained change.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { SQLInputValue, StatementSync } from 'node:sqlite';
import { config } from '../config.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>;

if (config.dbPath !== ':memory:') fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

export const db = new DatabaseSync(config.dbPath);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');
db.exec(fs.readFileSync(path.join(import.meta.dirname, 'schema.sql'), 'utf8'));

const cache = new Map<string, StatementSync>();
function stmt(sql: string): StatementSync {
  let s = cache.get(sql);
  if (!s) {
    if (cache.size > 1000) cache.clear();
    s = db.prepare(sql);
    cache.set(sql, s);
  }
  return s;
}

function norm(params: unknown[]): SQLInputValue[] {
  return params.map((v) => {
    if (v === undefined) return null;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (v !== null && typeof v === 'object' && !(v instanceof Uint8Array)) return JSON.stringify(v);
    return v as SQLInputValue;
  });
}

export function all<T = Row>(sql: string, ...params: unknown[]): T[] {
  return stmt(sql).all(...norm(params)) as T[];
}

export function get<T = Row>(sql: string, ...params: unknown[]): T | undefined {
  return stmt(sql).get(...norm(params)) as T | undefined;
}

export function run(sql: string, ...params: unknown[]): { changes: number; id: number } {
  const r = stmt(sql).run(...norm(params));
  return { changes: Number(r.changes), id: Number(r.lastInsertRowid) };
}

let depth = 0;
/** Runs `fn` in a transaction. Nested calls join the outer transaction. `fn` must be synchronous. */
export function tx<T>(fn: () => T): T {
  if (depth > 0) return fn();
  depth++;
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  } finally {
    depth--;
  }
}

export function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || !value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export const qs = (n: number) => Array(n).fill('?').join(',');

/** UTC timestamp in the schema's text format, offset by `ms` from now. */
export function sqlTime(ms = 0): string {
  return new Date(Date.now() + ms).toISOString().replace('T', ' ').slice(0, 19);
}

export const DAY = 86_400_000;
export const HOUR = 3_600_000;
export const MINUTE = 60_000;
