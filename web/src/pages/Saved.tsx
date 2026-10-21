import { useState } from 'react';
import { BusinessCard, JobCard, ProductCard } from '../components/Cards.tsx';
import { PostCard } from '../components/PostCard.tsx';
import { Empty, PageTitle, Spinner, Tabs } from '../components/ui.tsx';
import { useApi } from '../lib/hooks.ts';
import type { Json } from '../lib/api.ts';

const SAVED_ICONS = { products: 'bag', jobs: 'briefcase', posts: 'image', businesses: 'building' } as const;

export default function Saved() {
  const { data, loading } = useApi('/saves');
  const [tab, setTab] = useState<'products' | 'jobs' | 'posts' | 'businesses'>('products');
  if (loading) return <Spinner block />;
  const items: Json[] = data?.[tab] ?? [];
  return (
    <main className="page page-mid">
      <PageTitle title="Saved" subtitle="Products, jobs, posts and businesses you saved for later." />
      <Tabs
        tabs={(['products', 'jobs', 'posts', 'businesses'] as const).map((t) => ({ id: t, label: t[0].toUpperCase() + t.slice(1), icon: SAVED_ICONS[t], count: data?.[t]?.length ?? 0 }))}
        value={tab}
        onChange={setTab}
      />
      <div className="mt">
        {!items.length ? <div className="card"><Empty icon="bookmark" title={`No saved ${tab}`} /></div>
          : tab === 'products' ? <div className="grid-cards">{items.map((p) => <ProductCard key={p.id} p={p} />)}</div>
          : tab === 'jobs' ? <div className="stack">{items.map((j) => <JobCard key={j.id} j={j} />)}</div>
          : tab === 'posts' ? <div className="stack">{items.map((p) => <PostCard key={p.id} post={p} />)}</div>
          : <div className="grid-3">{items.map((b) => <BusinessCard key={b.id} b={{ ...b, kind: b.account_type }} />)}</div>}
      </div>
    </main>
  );
}
