export function parseTime(t: string): Date {
  return new Date(t.includes('T') ? t : t.replace(' ', 'T') + 'Z');
}

export function timeAgo(t?: string | null): string {
  if (!t) return '';
  const s = Math.max(0, (Date.now() - parseTime(t).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d`;
  return parseTime(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: s > 86400 * 300 ? 'numeric' : undefined });
}

export function dateLabel(t?: string | null): string {
  if (!t) return '';
  return parseTime(t.length === 10 ? t + 'T00:00:00' : t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function money(amount?: number | null, currency = 'TZS'): string {
  if (amount == null) return '';
  return `${currency} ${Math.round(amount).toLocaleString('en-US')}`;
}

export function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(n);
}

export function salary(j: { salary_min?: number | null; salary_max?: number | null; currency?: string; salary_period?: string }): string {
  if (j.salary_min == null && j.salary_max == null) return 'Salary not disclosed';
  const c = j.currency ?? 'TZS';
  const per = j.salary_period ? ` / ${j.salary_period}` : '';
  const k = (n: number) => compact(n);
  if (j.salary_min != null && j.salary_max != null) return `${c} ${k(j.salary_min)}–${k(j.salary_max)}${per}`;
  return `${c} ${k((j.salary_min ?? j.salary_max)!)}${j.salary_min != null ? '+' : ''}${per}`;
}

export const label = (s?: string | null) => (s ? s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : '');

export const ACCOUNT_LABEL: Record<string, string> = {
  personal: 'Personal', company: 'Company', wholesaler: 'Wholesaler', retailer: 'Retailer', customer: 'Customer',
};

export const STAGE_LABEL: Record<string, string> = {
  applied: 'Applied', reviewing: 'Reviewing', shortlisted: 'Shortlisted', interview: 'Interview',
  final_review: 'Final review', accepted: 'Accepted', rejected: 'Rejected', withdrawn: 'Withdrawn',
};

export const ANNOUNCEMENT_LABEL: Record<string, string> = {
  price_increase: 'Price increase', price_decrease: 'Price decrease', new_product: 'New product',
  product_discontinued: 'Product discontinued', new_service: 'New service', store_opening: 'Store opening',
  service_interruption: 'Service interruption', hiring: 'Hiring', promotion: 'Promotional offer', event: 'Business event',
};

export const DOC_LABEL: Record<string, string> = {
  cv: 'CV / Résumé', certificate: 'Certificate', portfolio: 'Portfolio', cover_letter: 'Cover letter',
  id: 'Identification document', academic: 'Academic qualification', business_registration: 'Business registration', other: 'Other',
};

export function initials(name?: string | null): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

export function hue(s: string): number {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

export function fileSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
