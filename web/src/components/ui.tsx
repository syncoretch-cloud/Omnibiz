import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode, InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation } from 'react-router';
import { Icon } from './Icon.tsx';
import type { IconName } from './Icon.tsx';
import { Artwork } from './Artwork.tsx';
import { hue, initials } from '../lib/format.ts';
import type { Json } from '../lib/api.ts';

const AVATAR_GRADIENTS = [
  'linear-gradient(145deg, #6d324f, #1c1e3a)',
  'linear-gradient(145deg, #b85c4a, #6d324f)',
  'linear-gradient(145deg, #e89f6e, #b85c4a)',
  'linear-gradient(145deg, #80616f, #40263a)',
  'linear-gradient(145deg, #40263a, #1c1e3a)',
  'linear-gradient(145deg, #d9a07e, #80616f)',
  'linear-gradient(145deg, #8a4466, #40263a)',
  'linear-gradient(145deg, #c97a5c, #40263a)',
];

export function Avatar({ user, size = 40, square }: { user?: Json; size?: number; square?: boolean }) {
  const name = user?.display_name ?? user?.name ?? '?';
  const isBiz = ['company', 'wholesaler', 'retailer'].includes(user?.account_type) || square;
  return (
    <div
      className={`avatar${isBiz ? ' square' : ''}`}
      style={{ width: size, height: size, fontSize: size * 0.36, background: user?.avatar_url ? 'var(--surface-2)' : AVATAR_GRADIENTS[hue(name) % AVATAR_GRADIENTS.length] }}
      aria-hidden="true"
    >
      {user?.avatar_url ? <img src={user.avatar_url} alt="" loading="lazy" /> : initials(name)}
    </div>
  );
}

/** Instagram-style gradient story ring around an avatar. */
export function Ring({ children, seen, square, onClick, title }: { children: ReactNode; seen?: boolean; square?: boolean; onClick?: () => void; title?: string }) {
  const cls = `ring${seen ? ' seen' : ''}${square ? ' square' : ''}`;
  const inner = <span className="ring-gap">{children}</span>;
  return onClick ? <button type="button" className={cls} onClick={onClick} title={title} aria-label={title}>{inner}</button> : <span className={cls}>{inner}</span>;
}

export function Verified({ show }: { show?: boolean }) {
  if (!show) return null;
  return (
    <span className="verified" title="Verified business">
      <Icon name="verified" />
    </span>
  );
}

export function UserName({ user, link = true }: { user: Json; link?: boolean }) {
  if (!user) return <span className="muted">Unknown</span>;
  const inner = (
    <>
      {user.display_name} <Verified show={user.verified} />
    </>
  );
  return link ? <Link to={`/u/${user.username}`} className="post-author bold" style={{ color: 'var(--text)' }}>{inner}</Link> : <span className="post-author bold">{inner}</span>;
}

export function Spinner({ block }: { block?: boolean }) {
  return block ? <div className="spinner-wrap"><div className="spinner" /></div> : <div className="spinner" />;
}

export function Empty({ icon = 'info', title, children }: { icon?: string; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <Icon name={icon} />
      <div className="bold" style={{ color: 'var(--text)' }}>{title}</div>
      {children && <div className="small">{children}</div>}
    </div>
  );
}

export function ErrorBox({ error }: { error?: Error | string | null }) {
  if (!error) return null;
  return <div className="form-error" role="alert">{typeof error === 'string' ? error : error.message}</div>;
}

export function Field({ label, hint, error, children, className }: { label?: ReactNode; hint?: ReactNode; error?: string; children: ReactNode; className?: string }) {
  return (
    <div className={`field ${className ?? ''}`}>
      {label && <label>{label}</label>}
      {children}
      {error ? <span className="error">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

export const Input = (p: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={`input ${p.className ?? ''}`} />;
export const Textarea = (p: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...p} className={`textarea ${p.className ?? ''}`} />;
export function Select({ options, placeholder, ...p }: SelectHTMLAttributes<HTMLSelectElement> & { options: { value: string; label: string }[] | string[]; placeholder?: string }) {
  return (
    <select {...p} className={`select ${p.className ?? ''}`}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => (typeof o === 'string' ? <option key={o} value={o}>{o}</option> : <option key={o.value} value={o.value}>{o.label}</option>))}
    </select>
  );
}

export function TagInput({ value, onChange, placeholder, suggestions }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string; suggestions?: string[] }) {
  const [text, setText] = useState('');
  const add = (t: string) => {
    const v = t.trim().replace(/,$/, '');
    if (v && !value.some((x) => x.toLowerCase() === v.toLowerCase())) onChange([...value, v]);
    setText('');
  };
  const listId = useRef(`tags-${Math.random().toString(36).slice(2)}`).current;
  return (
    <div className="tag-input">
      {value.map((t) => (
        <span key={t} className="chip chip-brand">
          {t}
          <button type="button" className="icon-btn" style={{ padding: 0 }} onClick={() => onChange(value.filter((x) => x !== t))} aria-label={`Remove ${t}`}>
            <Icon name="x" size={12} />
          </button>
        </span>
      ))}
      <input
        value={text}
        list={suggestions ? listId : undefined}
        placeholder={value.length ? '' : placeholder}
        onChange={(e) => (e.target.value.endsWith(',') ? add(e.target.value) : setText(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); add(text); }
          if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={() => text && add(text)}
      />
      {suggestions && <datalist id={listId}>{suggestions.map((s) => <option key={s} value={s} />)}</datalist>}
    </div>
  );
}

/** Renders overlays at the end of <body>, so page layout (containers, transforms, filters, scrolling panels) can never offset or clip them. */
export function Portal({ children }: { children: ReactNode }) {
  return createPortal(children, document.body);
}

export function Modal({ title, onClose, children, footer, large }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; large?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return (
    <Portal>
      <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        <div className={`modal${large ? ' modal-lg' : ''}`} role="dialog" aria-modal="true">
          <div className="modal-head">
            <h3>{title}</h3>
            <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
          </div>
          <div className="modal-body">{children}</div>
          {footer && <div className="modal-foot">{footer}</div>}
        </div>
      </div>
    </Portal>
  );
}

export function Dropdown({ trigger, children, align = 'right' }: { trigger: (open: boolean) => ReactNode; children: ReactNode; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div className="dropdown" ref={ref}>
      <div onClick={() => setOpen((o) => !o)}>{trigger(open)}</div>
      {open && (
        <div className="dropdown-menu" style={align === 'left' ? { left: 0, right: 'auto', transformOrigin: 'top left' } : undefined} onClick={() => setOpen(false)}>
          {children}
        </div>
      )}
    </div>
  );
}

/** Pill tabs. A tab with an icon shows just the icon until it is the current one, then its name too. */
export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string; icon?: IconName; count?: number }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} aria-label={t.label} title={t.icon && value !== t.id ? t.label : undefined}
          className={`tab${t.icon ? ' has-icon' : ''}${value === t.id ? ' active' : ''}`} onClick={() => onChange(t.id)}>
          {t.icon ? <><Icon name={t.icon} /><span className="tab-text">{t.label}</span></> : t.label}
          {t.count != null && <span className="count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** Re-mounts its children with a slide/fade whenever `k` changes; slides in the direction of travel through `order`. */
export function Swap({ k, order, children, className, style }: { k: string | number; order?: (string | number)[]; children: ReactNode; className?: string; style?: CSSProperties }) {
  const prev = useRef(k);
  const dir = useRef(1);
  if (prev.current !== k) {
    if (order) dir.current = order.indexOf(k) >= order.indexOf(prev.current) ? 1 : -1;
    prev.current = k;
  }
  return (
    <div key={k} className={`swap-enter ${className ?? ''}`} style={{ ['--swap-from' as string]: `${dir.current * 22}px`, ...style }}>
      {children}
    </div>
  );
}

/** Slide/fade between nested routes (dashboard, admin and settings sections). */
export function SectionSwap({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return <Swap k={pathname}>{children}</Swap>;
}

export function LoadMore({ hasMore, loading, onClick }: { hasMore: boolean; loading: boolean; onClick: () => void }) {
  const sentinel = useRef<HTMLDivElement>(null);
  // Infinite scroll: load the next page as the sentinel nears the viewport; the button stays as a fallback.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore || loading) return;
    const io = new IntersectionObserver((entries) => entries[0].isIntersecting && onClick(), { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loading, onClick]);
  if (loading) return <Spinner block />;
  if (!hasMore) return null;
  return (
    <div className="center" ref={sentinel}>
      <button className="btn btn-outline" onClick={onClick}>Load more</button>
    </div>
  );
}

export function Placeholder({ seed, icon = 'package' }: { seed: string; icon?: string; label?: string }) {
  return <Artwork seed={seed} icon={icon} variant="thumb" />;
}

export function Stars({ value }: { value: number }) {
  const full = Math.round(value);
  return <span className="stars" aria-label={`${value} out of 5`}>{'★'.repeat(full)}<span style={{ opacity: 0.3 }}>{'★'.repeat(5 - full)}</span></span>;
}

export function MatchRing({ score }: { score: number }) {
  const color = score >= 75 ? 'var(--brand)' : score >= 50 ? 'var(--brand-2)' : 'var(--muted)';
  return (
    <div className="match-ring" style={{ ['--p' as string]: score, ['--ring-color' as string]: color }} title={`${score}% match`}>
      <div>{score}%</div>
    </div>
  );
}

export function Visibility({ value }: { value: string }) {
  const icon = value === 'public' ? 'globe' : value === 'recruiters' ? 'briefcase' : 'lock';
  const text = value === 'public' ? 'Public' : value === 'recruiters' ? 'Recruiters only' : 'Private';
  return <span className="vis"><Icon name={icon} />{text}</span>;
}

export function VisibilitySelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      options={[{ value: 'public', label: 'Public' }, { value: 'recruiters', label: 'Recruiters only' }, { value: 'private', label: 'Private' }]}
      style={{ width: 'auto', minHeight: 34, padding: '4px 34px 4px 12px', fontSize: '0.8rem' }}
      aria-label="Visibility"
    />
  );
}

export function PageTitle({ title, subtitle, actions, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: string }) {
  return (
    <div className="row-between" style={{ marginBottom: 20, flexWrap: 'wrap' }}>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        {back && <Link to={back} className="btn btn-icon btn-sm" aria-label="Back"><Icon name="arrowLeft" /></Link>}
        <div>
          <h1>{title}</h1>
          {subtitle && <p className="muted small" style={{ marginTop: 4 }}>{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="row-wrap">{actions}</div>}
    </div>
  );
}
