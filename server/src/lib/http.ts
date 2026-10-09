import type { Request } from 'express';

export class HttpError extends Error {
  status: number;
  details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const badRequest = (msg: string, details?: unknown) => new HttpError(400, msg, details);
export const unauthorized = (msg = 'Please sign in to continue') => new HttpError(401, msg);
export const forbidden = (msg = 'You do not have permission to do that') => new HttpError(403, msg);
export const notFound = (what = 'Resource') => new HttpError(404, `${what} not found`);
export const conflict = (msg: string) => new HttpError(409, msg);

export function intParam(req: Request, name = 'id'): number {
  const n = Number(req.params[name]);
  if (!Number.isInteger(n) || n <= 0) throw notFound();
  return n;
}

export function paging(req: Request, defLimit = 20, maxLimit = 50) {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(maxLimit, Math.max(1, Number(req.query.limit) || defLimit));
  return { page, limit, offset: (page - 1) * limit };
}

export function qStr(req: Request, name: string): string | undefined {
  const v = req.query[name];
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t ? t.slice(0, 200) : undefined;
}

export function qNum(req: Request, name: string): number | undefined {
  const v = qStr(req, name);
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

// ───────────── Input validation ─────────────
type FieldType = 'string' | 'text' | 'int' | 'number' | 'bool' | 'enum' | 'strings' | 'ints' | 'date' | 'json' | 'email' | 'url';
export interface Field {
  type: FieldType;
  required?: boolean;
  max?: number;
  min?: number;
  values?: readonly string[];
}
export type Spec = Record<string, Field>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function validate(input: any, spec: Spec, opts: { partial?: boolean } = {}): Record<string, any> {
  const src = input && typeof input === 'object' ? input : {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out: Record<string, any> = {};
  const errors: Record<string, string> = {};

  for (const [key, f] of Object.entries(spec)) {
    const raw = src[key];
    if (raw === undefined) {
      if (f.required && !opts.partial) errors[key] = 'is required';
      continue;
    }
    const empty = raw === null || (typeof raw === 'string' && raw.trim() === '');
    if (empty) {
      if (f.required) errors[key] = 'is required';
      else out[key] = f.type === 'strings' || f.type === 'ints' ? [] : null;
      continue;
    }
    try {
      out[key] = coerce(raw, f);
    } catch (e) {
      errors[key] = (e as Error).message;
    }
  }
  if (Object.keys(errors).length) {
    const first = Object.entries(errors)[0];
    throw badRequest(`${humanize(first[0])} ${first[1]}`, { fields: errors });
  }
  return out;
}

function humanize(key: string) {
  const s = key.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function coerce(raw: unknown, f: Field): unknown {
  switch (f.type) {
    case 'string':
    case 'text': {
      if (typeof raw !== 'string' && typeof raw !== 'number') throw new Error('must be text');
      const s = String(raw).trim();
      const max = f.max ?? (f.type === 'text' ? 5000 : 200);
      if (s.length > max) throw new Error(`must be at most ${max} characters`);
      if (f.min && s.length < f.min) throw new Error(`must be at least ${f.min} characters`);
      return s;
    }
    case 'email': {
      const s = String(raw).trim().toLowerCase();
      if (!EMAIL.test(s) || s.length > 200) throw new Error('must be a valid email address');
      return s;
    }
    case 'url': {
      let s = String(raw).trim();
      if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
      try {
        new URL(s);
      } catch {
        throw new Error('must be a valid link');
      }
      if (s.length > 500) throw new Error('is too long');
      return s;
    }
    case 'int':
    case 'number': {
      const n = Number(raw);
      if (!Number.isFinite(n)) throw new Error('must be a number');
      if (f.type === 'int' && !Number.isInteger(n)) throw new Error('must be a whole number');
      if (f.min !== undefined && n < f.min) throw new Error(`must be at least ${f.min}`);
      if (f.max !== undefined && n > f.max) throw new Error(`must be at most ${f.max}`);
      return n;
    }
    case 'bool':
      return raw === true || raw === 'true' || raw === 1 || raw === '1' || raw === 'on';
    case 'enum':
      if (!f.values?.includes(String(raw))) throw new Error('is not a valid option');
      return String(raw);
    case 'strings': {
      const arr = Array.isArray(raw) ? raw : String(raw).split(',');
      const items = arr.map((x) => String(x).trim()).filter(Boolean);
      const max = f.max ?? 50;
      if (items.length > max) throw new Error(`can have at most ${max} entries`);
      if (items.some((x) => x.length > 200)) throw new Error('has an entry that is too long');
      return [...new Set(items)];
    }
    case 'ints': {
      const arr = Array.isArray(raw) ? raw : String(raw).split(',');
      const items = arr.map(Number);
      if (items.some((n) => !Number.isInteger(n) || n <= 0)) throw new Error('must be a list of ids');
      return [...new Set(items)].slice(0, f.max ?? 50);
    }
    case 'date': {
      const s = String(raw).trim();
      if (!/^\d{4}-\d{2}-\d{2}/.test(s) || Number.isNaN(Date.parse(s))) throw new Error('must be a valid date');
      return s.slice(0, 10);
    }
    case 'json': {
      if (typeof raw !== 'object') throw new Error('must be an object');
      if (JSON.stringify(raw).length > 20_000) throw new Error('is too large');
      return raw;
    }
  }
}
