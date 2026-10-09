import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Icon } from '../components/Icon.tsx';
import { ProductCard } from '../components/Cards.tsx';
import { Empty, Input, LoadMore, PageTitle, Select } from '../components/ui.tsx';
import { usePaged } from '../lib/hooks.ts';
import { qs } from '../lib/api.ts';
import type { Json } from '../lib/api.ts';
import { useSession } from '../lib/session.tsx';

export default function Marketplace() {
  const { meta, can, me } = useSession();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [text, setText] = useState(params.get('q') ?? '');
  const [compare, setCompare] = useState<Json[]>([]);
  const f = Object.fromEntries(params.entries());
  const set = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v); else p.delete(k);
    setParams(p);
  };
  const near = f.sort === 'nearest' && me?.user.lat != null ? { lat: me.user.lat, lng: me.user.lng } : {};
  const list = usePaged(`/products${qs({ ...f, ...near })}`);
  const toggleCompare = (p: Json) =>
    setCompare((c) => (c.some((x) => x.id === p.id) ? c.filter((x) => x.id !== p.id) : c.length >= 4 ? c : [...c, p]));

  const SALE = [{ v: '', l: 'All' }, { v: 'retail', l: 'Retail' }, { v: 'wholesale', l: 'Wholesale' }, { v: 'service', l: 'Services' }];

  return (
    <main className="page">
      <PageTitle
        title="Marketplace"
        subtitle="Products and services from verified companies, wholesalers and retailers."
        actions={can('manage_products') ? <Link to="/dashboard/products?new=1" className="btn btn-primary"><Icon name="plus" />Sell something</Link> : undefined}
      />
      <div className="layout-side">
        <aside className="card card-pad stack sticky-side" style={{ gap: 14 }}>
          <form onSubmit={(e) => { e.preventDefault(); set('q', text); }} className="input-icon">
            <Icon name="search" />
            <Input placeholder="Search products" value={text} onChange={(e) => setText(e.target.value)} />
          </form>
          <div>
            <div className="section-title" style={{ marginBottom: 6 }}>Type</div>
            <div className="row-wrap">{SALE.map((s) => <button key={s.v} className={`chip${(f.sale_type ?? '') === s.v ? ' active' : ''}`} onClick={() => set('sale_type', s.v)}>{s.l}</button>)}</div>
          </div>
          <div>
            <div className="section-title" style={{ marginBottom: 6 }}>Category</div>
            <Select value={f.category ?? ''} onChange={(e) => set('category', e.target.value)} placeholder="All categories" options={(meta?.product_categories ?? []).map((c) => ({ value: c.slug, label: c.name }))} />
          </div>
          <div>
            <div className="section-title" style={{ marginBottom: 6 }}>Location</div>
            <Select value={f.city ?? ''} onChange={(e) => set('city', e.target.value)} placeholder="Anywhere" options={(meta?.cities ?? []).map((c) => c.name)} />
          </div>
          <div>
            <div className="section-title" style={{ marginBottom: 6 }}>Price (TZS)</div>
            <div className="row">
              <Input type="number" min={0} placeholder="Min" defaultValue={f.min_price} onBlur={(e) => set('min_price', e.target.value)} />
              <Input type="number" min={0} placeholder="Max" defaultValue={f.max_price} onBlur={(e) => set('max_price', e.target.value)} />
            </div>
          </div>
          <label className="checkbox"><input type="checkbox" checked={f.in_stock === '1'} onChange={(e) => set('in_stock', e.target.checked ? '1' : '')} />In stock only</label>
          <label className="checkbox"><input type="checkbox" checked={f.verified === '1'} onChange={(e) => set('verified', e.target.checked ? '1' : '')} />Verified sellers only</label>
          {Object.keys(f).length > 0 && <button className="btn btn-ghost btn-sm" onClick={() => { setParams({}); setText(''); }}>Clear filters</button>}
        </aside>
        <section className="stack">
          <div className="row-between">
            <span className="small muted">{list.extra?.total ?? 0} results</span>
            <Select value={f.sort ?? ''} onChange={(e) => set('sort', e.target.value)} placeholder={f.q ? 'Most relevant' : 'Newest'} options={[
              { value: 'newest', label: 'Newest' }, { value: 'price_asc', label: 'Price: low to high' }, { value: 'price_desc', label: 'Price: high to low' },
              { value: 'popular', label: 'Most viewed' }, { value: 'nearest', label: 'Nearest to me' },
            ]} style={{ width: 'auto' }} aria-label="Sort" />
          </div>
          <div className="grid-cards">
            {list.items.map((p: Json) => <ProductCard key={p.id} p={p} compare={{ selected: compare.some((c) => c.id === p.id), toggle: () => toggleCompare(p) }} />)}
          </div>
          {!list.loading && !list.items.length && <div className="card"><Empty icon="store" title="No products found">Try a broader search or another category.</Empty></div>}
          <LoadMore hasMore={list.hasMore} loading={list.loading} onClick={list.loadMore} />
        </section>
      </div>
      {compare.length > 0 && (
        <div className="compare-tray">
          <span className="small bold">{compare.length} selected to compare</span>
          <button className="btn btn-sm btn-ghost" style={{ color: 'inherit' }} onClick={() => setCompare([])}>Clear</button>
          <button className="btn btn-sm btn-primary" disabled={compare.length < 2} onClick={() => nav(`/marketplace/compare?ids=${compare.map((c) => c.id).join(',')}`)}>Compare</button>
        </div>
      )}
    </main>
  );
}
