import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Icon } from '../components/Icon.tsx';
import { BusinessCard, JobCard, PersonRow, ProductCard } from '../components/Cards.tsx';
import { PostCard } from '../components/PostCard.tsx';
import { Empty, Input, PageTitle, Select, Spinner, Tabs } from '../components/ui.tsx';
import { useApi } from '../lib/hooks.ts';
import { qs } from '../lib/api.ts';
import type { Json } from '../lib/api.ts';
import { useSession } from '../lib/session.tsx';

const TYPES = [
  { id: 'all', label: 'All' }, { id: 'jobs', label: 'Jobs' }, { id: 'people', label: 'People' }, { id: 'companies', label: 'Companies' },
  { id: 'wholesalers', label: 'Wholesalers' }, { id: 'retailers', label: 'Retailers' }, { id: 'products', label: 'Products' },
  { id: 'services', label: 'Services' }, { id: 'posts', label: 'Posts' },
];

const EXAMPLES = [
  'Find software companies around Arusha hiring junior developers',
  'solar panels wholesale Dar es Salaam',
  'nurse jobs Moshi',
  'kitenge dress Zanzibar',
  'accountant',
];

export default function Search() {
  const { meta } = useSession();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const type = params.get('type') ?? 'all';
  const city = params.get('city') ?? '';
  const [text, setText] = useState(q);
  useEffect(() => {
    setText(q);
  }, [q]);
  const { data, loading } = useApi(q || city ? `/search${qs({ q, type, city, limit: type === 'all' ? 6 : 30 })}` : null);
  const set = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v); else p.delete(k);
    setParams(p);
  };
  const r = data?.results ?? {};
  const it = data?.interpreted;
  const section = (key: string, title: string, children: React.ReactNode, moreType?: string) =>
    r[key]?.length ? (
      <section className="stack-sm">
        <div className="row-between"><h3>{title}</h3>{type === 'all' && moreType && <button className="btn btn-ghost btn-sm" onClick={() => set('type', moreType)}>See all</button>}</div>
        {children}
      </section>
    ) : null;
  const total = Object.values(data?.counts ?? {}).reduce((a: number, b) => a + (b as number), 0);

  return (
    <main className="page page-mid">
      <PageTitle title="Search" subtitle="Search everything on OmniBiz — or just ask in plain language." />
      <div className="stack">
        <form className="card card-pad stack-sm" onSubmit={(e) => { e.preventDefault(); set('q', text); }}>
          <div className="row">
            <div className="input-icon grow"><Icon name="search" /><Input value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. software companies around Arusha hiring junior developers" autoFocus /></div>
            <button className="btn btn-primary">Search</button>
          </div>
          <div className="row-wrap">
            <Select value={city} onChange={(e) => set('city', e.target.value)} placeholder="Any location" options={(meta?.cities ?? []).map((c) => c.name)} style={{ width: 'auto' }} aria-label="Location" />
          </div>
        </form>
        <Tabs tabs={TYPES} value={type} onChange={(v) => set('type', v === 'all' ? '' : v)} />

        {!q && !city && (
          <div className="card card-pad stack-sm">
            <div className="section-title">Try asking</div>
            {EXAMPLES.map((e) => <Link key={e} to={`/search?q=${encodeURIComponent(e)}`} className="row small"><Icon name="sparkles" size={16} />{e}</Link>)}
          </div>
        )}
        {it?.summary && (it.types.length > 0 || it.city || it.junior) && (
          <div className="banner banner-info small"><Icon name="sparkles" /><span>Showing <b>{it.summary}</b></span></div>
        )}
        {loading && <Spinner block />}
        {!loading && data && total === 0 && <div className="card"><Empty icon="search" title={`No results for “${q}”`}>Check the spelling or try fewer words.</Empty></div>}
        {!loading && data && (
          <div className="stack-lg">
            {section('jobs', 'Jobs', <div className="stack-sm">{r.jobs?.map((j: Json) => <JobCard key={j.id} j={j} />)}</div>, 'jobs')}
            {section('businesses', 'Businesses', <div className="grid-3">{r.businesses?.map((b: Json) => <BusinessCard key={b.id} b={b} />)}</div>, 'companies')}
            {section('people', 'People', <div className="card">{r.people?.map((u: Json) => <PersonRow key={u.id} u={u} />)}</div>, 'people')}
            {section('products', 'Products', <div className="grid-cards">{r.products?.map((p: Json) => <ProductCard key={p.id} p={p} />)}</div>, 'products')}
            {section('services', 'Services', <div className="card">{r.services?.map((s: Json, i: number) => <PersonRow key={i} u={{ ...s.business, headline: s.service }} />)}</div>, 'services')}
            {section('posts', 'Posts', <div className="stack">{r.posts?.map((p: Json) => <PostCard key={p.id} post={p} />)}</div>, 'posts')}
          </div>
        )}
      </div>
    </main>
  );
}
