import { Link, useSearchParams } from 'react-router';
import { Avatar, Empty, PageTitle, Placeholder, Spinner, Stars, Verified } from '../components/ui.tsx';
import { useApi } from '../lib/hooks.ts';
import type { Json } from '../lib/api.ts';
import { useSession } from '../lib/session.tsx';
import { label, money } from '../lib/format.ts';

export default function Compare() {
  const [params] = useSearchParams();
  const { productCategoryName } = useSession();
  const { data, loading, error } = useApi(`/products/compare?ids=${params.get('ids') ?? ''}`);
  if (loading) return <Spinner block />;
  if (error) return <main className="page page-narrow"><div className="card"><Empty icon="alert" title="Cannot compare">{error.message}</Empty></div></main>;
  const items: Json[] = data.items;
  const cheapest = Math.min(...items.map((p) => p.price));
  const rows: [string, (p: Json) => React.ReactNode][] = [
    ['Price', (p) => <span className={p.price === cheapest ? 'bold' : ''} style={p.price === cheapest ? { color: 'var(--success)' } : undefined}>{money(p.price, p.currency)}</span>],
    ['Type', (p) => label(p.sale_type)],
    ['Minimum order', (p) => p.min_order_qty],
    ['Availability', (p) => `${label(p.availability)}${p.quantity != null ? ` (${p.quantity})` : ''}`],
    ['Category', (p) => productCategoryName(p.category)],
    ['Seller', (p) => <span className="row" style={{ gap: 4 }}><Avatar user={p.seller} size={22} />{p.seller?.display_name}<Verified show={p.seller?.verified} /></span>],
    ['Location', (p) => p.city ?? '—'],
    ['Rating', (p) => (p.rating ? <><Stars value={p.rating.avg} /> ({p.rating.count})</> : '—')],
    ['Delivery', (p) => p.delivery_options.map(label).join(', ') || '—'],
    ...data.spec_keys.map((k: string) => [k, (p: Json) => p.specs[k] ?? '—'] as [string, (p: Json) => React.ReactNode]),
  ];
  return (
    <main className="page">
      <PageTitle title="Compare products" back="/marketplace" />
      <div className="card table-wrap">
        <table className="table" style={{ minWidth: 160 * (items.length + 1) }}>
          <thead>
            <tr>
              <th />
              {items.map((p) => (
                <th key={p.id} style={{ textTransform: 'none', letterSpacing: 0, verticalAlign: 'top' }}>
                  <Link to={`/marketplace/${p.id}`} style={{ color: 'var(--text)' }}>
                    <div style={{ width: 140, borderRadius: 8, overflow: 'hidden', marginBottom: 8 }}>
                      {p.media[0] ? <img src={p.media[0]} alt="" style={{ aspectRatio: '4/3', objectFit: 'cover', width: '100%' }} /> : <Placeholder seed={p.category + p.name} />}
                    </div>
                    <div className="small bold">{p.name}</div>
                  </Link>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(([name, render]) => (
              <tr key={name}>
                <td className="muted small bold">{name}</td>
                {items.map((p) => <td key={p.id} className="small">{render(p)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
