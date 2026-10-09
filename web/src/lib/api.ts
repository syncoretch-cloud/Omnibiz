// Thin client for the OmniBiz API. Every mutating request carries the x-omnibiz header (CSRF guard).

export class ApiError extends Error {
  status: number;
  details?: { fields?: Record<string, string>; missing?: string[] };
  constructor(status: number, message: string, details?: ApiError['details']) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = any;

export async function api<T = Json>(path: string, opts: { method?: string; body?: unknown; form?: FormData; signal?: AbortSignal } = {}): Promise<T> {
  const headers: Record<string, string> = { 'x-omnibiz': '1' };
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  const res = await fetch(`/api${path}`, { method: opts.method ?? 'GET', headers, body, credentials: 'same-origin', signal: opts.signal });
  const text = await res.text();
  let data: Json = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`, data?.details);
  return data as T;
}

export const get = <T = Json>(path: string, signal?: AbortSignal) => api<T>(path, { signal });
export const post = <T = Json>(path: string, body: unknown = {}) => api<T>(path, { method: 'POST', body });
export const patch = <T = Json>(path: string, body: unknown) => api<T>(path, { method: 'PATCH', body });
export const put = <T = Json>(path: string, body: unknown) => api<T>(path, { method: 'PUT', body });
export const del = <T = Json>(path: string, body?: unknown) => api<T>(path, { method: 'DELETE', body });

export async function uploadMedia(files: File[]): Promise<string[]> {
  const form = new FormData();
  for (const f of files) form.append('files', f);
  const r = await api<{ files: { url: string }[] }>('/media', { method: 'POST', form });
  return r.files.map((f) => f.url);
}

export async function uploadDocument(file: File, kind: string, visibility = 'private', name?: string) {
  const form = new FormData();
  form.append('kind', kind);
  form.append('visibility', visibility);
  if (name) form.append('name', name);
  form.append('file', file);
  const r = await api<{ document: Json }>('/documents', { method: 'POST', form });
  return r.document;
}

export function qs(params: Record<string, unknown>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '' && v !== false) p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}
