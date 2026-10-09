// Generated artwork for content without photos: a deterministic mesh gradient (brand + IG
// sunset palette), a clay orb, film grain, a large glyph and serif typography.
import type { CSSProperties, ReactNode } from 'react';
import { Icon } from './Icon.tsx';
import type { Json } from '../lib/api.ts';
import { ANNOUNCEMENT_LABEL, label, money, salary } from '../lib/format.ts';

// Midnight · aubergine · plum · terracotta · apricot · vanilla · ivory · dusty rose · mauve · beige.
const PALETTES = [
  ['#1c1e3a', '#40263a', '#6d324f', '#e89f6e'],
  ['#40263a', '#6d324f', '#b85c4a', '#f7e6c4'],
  ['#1c1e3a', '#6d324f', '#e89f6e', '#fff4df'],
  ['#40263a', '#80616f', '#d9c5c8', '#e89f6e'],
  ['#6d324f', '#b85c4a', '#e89f6e', '#f7e6c4'],
  ['#1c1e3a', '#40263a', '#b85c4a', '#d9c5a8'],
  ['#40263a', '#6d324f', '#d9c5a8', '#fff4df'],
  ['#1c1e3a', '#80616f', '#e89f6e', '#f7e6c4'],
];

function h32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function artBackground(seed: string): string {
  const h = h32(seed);
  const p = PALETTES[h % PALETTES.length];
  const at = (shift: number) => ((h >>> shift) % 70) + 12;
  return [
    `radial-gradient(at ${at(3)}% ${at(7)}%, ${p[3]} 0, transparent 44%)`,
    `radial-gradient(at ${at(11)}% ${at(15)}%, ${p[2]} 0, transparent 56%)`,
    `radial-gradient(at ${at(19)}% ${at(23)}%, ${p[1]} 0, transparent 62%)`,
    `linear-gradient(${h % 360}deg, ${p[0]}, ${p[1]})`,
  ].join(', ');
}

export interface ArtProps {
  seed: string;
  kicker?: ReactNode;
  title?: ReactNode;
  sub?: ReactNode;
  price?: ReactNode;
  icon?: string;
  variant?: 'post' | 'tile' | 'thumb' | 'reel' | 'story' | 'wide';
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

export function Artwork({ seed, kicker, title, sub, price, icon = 'sparkles', variant = 'post', className = '', style, children }: ArtProps) {
  const h = h32(seed);
  const orb = 26 + (h % 22);
  return (
    <div className={`art ${variant} ${className}`} style={{ background: artBackground(seed), ...style }} aria-hidden={!title}>
      {variant !== 'thumb' && (
        <span className="art-orb" style={{ width: `${orb}%`, aspectRatio: '1', left: `${((h >>> 5) % 55) - 6}%`, top: `${((h >>> 9) % 38) + 4}%` }} />
      )}
      <span className="art-glyph"><Icon name={icon} /></span>
      {variant !== 'thumb' && kicker && <span className="art-kicker">{kicker}</span>}
      {variant !== 'thumb' && title && <div className="art-title">{title}</div>}
      {variant !== 'thumb' && sub && <div className="art-sub">{sub}</div>}
      {variant !== 'thumb' && price && <div className="art-price">{price}</div>}
      {children}
    </div>
  );
}

// ───────────── content → artwork mapping ─────────────
const PRODUCT_ICON: Record<string, string> = {
  electronics: 'zap', 'phones-computers': 'smartphone', 'solar-energy': 'sun', 'building-materials': 'building', 'agri-inputs': 'leaf',
  food: 'package', beverages: 'cup', clothing: 'shirt', beauty: 'sparkles', health: 'heart', 'home-furniture': 'home',
  'vehicles-parts': 'truck', machinery: 'settings', 'office-stationery': 'edit', textiles: 'shirt', services: 'zap', other: 'tag',
};
const INDUSTRY_ICON: Record<string, string> = {
  technology: 'code', software: 'code', ai: 'sparkles', robotics: 'settings', engineering: 'settings', construction: 'building',
  agriculture: 'leaf', manufacturing: 'package', finance: 'cash', education: 'graduation', healthcare: 'heart', fashion: 'shirt',
  retail: 'bag', wholesale: 'truck', transport: 'truck', hospitality: 'cup', telecommunications: 'smartphone', 'real-estate': 'home',
  energy: 'sun', media: 'image', entertainment: 'play', consulting: 'briefcase', business: 'briefcase', entrepreneurship: 'zap',
  jobs: 'briefcase', 'food-beverage': 'cup', mining: 'layers',
};
const KIND: Record<string, [string, string]> = {
  promotion: ['Promotion', 'tag'], offer: ['Offer', 'tag'], event: ['Event', 'calendar'], hiring: ['We’re hiring', 'briefcase'],
  product: ['New in store', 'bag'], service: ['Service', 'zap'], news: ['News', 'megaphone'], update: ['Update', 'sparkles'],
};

export const productIcon = (category?: string) => PRODUCT_ICON[category ?? ''] ?? 'tag';
export const industryIcon = (category?: string) => INDUSTRY_ICON[category ?? ''] ?? 'sparkles';

/** First meaningful line of a post, without links, trailing hashtags or mentions. */
export function headline(text: string, max = 120): string {
  const line = (text ?? '')
    .split('\n')
    .map((l) => l.replace(/https?:\/\/\S+/g, '').replace(/(\s*[#@][\p{L}\p{N}_.]+)+\s*$/u, '').trim())
    .find((l) => l.length > 0) ?? '';
  if (line.length <= max) return line;
  const cut = line.slice(0, max);
  return cut.slice(0, cut.lastIndexOf(' ') > 40 ? cut.lastIndexOf(' ') : max) + '…';
}

const PRICE_CHANGE = /((?:TZS|KES|UGX|RWF|USD|EUR)\s?[\d,]+)\s*→\s*((?:TZS|KES|UGX|RWF|USD|EUR)?\s?[\d,]+)/;

export function postArt(p: Json): ArtProps {
  const seed = `post-${p.id}`;
  if (p.kind === 'announcement') {
    const m = PRICE_CHANGE.exec(p.body ?? '');
    return {
      seed,
      kicker: <><Icon name="megaphone" size={12} />{ANNOUNCEMENT_LABEL[p.data?.announcement_kind] ?? 'Announcement'}</>,
      title: headline(p.body, 90),
      price: m ? `${m[1]} → ${m[2]}` : undefined,
      icon: 'megaphone',
    };
  }
  const k = KIND[p.kind];
  const tag = (p.tags ?? [])[0];
  return {
    seed,
    kicker: k ? k[0] : tag ? `#${tag}` : p.author?.display_name,
    title: headline(p.body),
    sub: p.data?.event_date ? `${new Date(p.data.event_date).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}${p.data.event_location ? ` · ${p.data.event_location}` : ''}` : undefined,
    icon: k ? k[1] : industryIcon(p.category ?? p.author?.category),
  };
}

export function productArt(p: Json, withSeller = true): ArtProps {
  return {
    seed: `product-${p.id}-${p.category}`,
    kicker: p.sale_type === 'wholesale' ? 'Wholesale' : p.sale_type === 'service' ? 'Service' : 'Shop',
    title: p.name,
    sub: withSeller ? p.seller?.display_name : undefined,
    price: `${money(p.price, p.currency)}${p.sale_type === 'wholesale' && p.min_order_qty > 1 ? ` · min ${p.min_order_qty}` : ''}`,
    icon: productIcon(p.category),
  };
}

export function jobArt(j: Json): ArtProps {
  return {
    seed: `job-${j.id}`,
    kicker: <><Icon name="briefcase" size={12} />Hiring · {label(j.employment_type)}</>,
    title: j.title,
    sub: `${j.company?.display_name ?? ''} · ${j.remote ? 'Remote' : j.city ?? ''}`,
    price: salary(j),
    icon: industryIcon(j.industry),
  };
}
