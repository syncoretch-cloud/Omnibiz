import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Icon } from '../components/Icon.tsx';
import type { IconName } from '../components/Icon.tsx';
import { JobCard } from '../components/Cards.tsx';
import { ApplicationsOverview } from '../components/Applications.tsx';
import { Empty, Input, LoadMore, PageTitle, Select, Tabs } from '../components/ui.tsx';
import { usePaged } from '../lib/hooks.ts';
import { qs } from '../lib/api.ts';
import type { Json } from '../lib/api.ts';
import { useSession } from '../lib/session.tsx';
import { label } from '../lib/format.ts';

type Tab = 'recommended' | 'latest' | 'nearby' | 'saved' | 'applied';

function Filters({ value, onChange }: { value: Record<string, string>; onChange: (v: Record<string, string>) => void }) {
  const { meta } = useSession();
  const [q, setQ] = useState(value.q ?? '');
  const [open, setOpen] = useState(false);
  const set = (k: string, v: string) => onChange({ ...value, [k]: v });
  const active = Object.entries(value).filter(([k, v]) => v && k !== 'q').length;
  return (
    <div className={`card card-pad filter-panel${open ? ' open' : ''}`} style={{ ['--search-min' as string]: '260px' }}>
      <div className="filter-head">
        <form className="row" onSubmit={(e) => { e.preventDefault(); set('q', q); }}>
          <div className="input-icon grow"><Icon name="search" /><Input placeholder="Job title, skill or company" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <button className="btn btn-primary">Search</button>
        </form>
        <button type="button" className="btn btn-outline filters-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <Icon name="filter" />Filters{active > 0 && <span className="count">{active}</span>}
        </button>
      </div>
      <div className="filter-body">
        <Select value={value.industry ?? ''} onChange={(e) => set('industry', e.target.value)} placeholder="All industries" options={(meta?.industries ?? []).map((c) => ({ value: c.slug, label: c.name }))} aria-label="Industry" />
        <Select value={value.city ?? ''} onChange={(e) => set('city', e.target.value)} placeholder="Any location" options={(meta?.cities ?? []).map((c) => c.name)} aria-label="Location" />
        <Select value={value.employment_type ?? ''} onChange={(e) => set('employment_type', e.target.value)} placeholder="Any type" options={(meta?.employment_types ?? []).map((t) => ({ value: t, label: label(t) }))} aria-label="Employment type" />
        <Select value={value.posted_within ?? ''} onChange={(e) => set('posted_within', e.target.value)} placeholder="Any time" options={[{ value: '1', label: 'Past 24 hours' }, { value: '7', label: 'Past week' }, { value: '30', label: 'Past month' }]} aria-label="Date posted" />
        <Input type="number" min={0} placeholder="Min. salary (TZS)" value={value.min_salary ?? ''} onChange={(e) => set('min_salary', e.target.value)} aria-label="Minimum salary" />
        <Input placeholder="Skill, e.g. React" value={value.skill ?? ''} onChange={(e) => set('skill', e.target.value)} aria-label="Skill" />
        <Select value={value.sort ?? ''} onChange={(e) => set('sort', e.target.value)} placeholder="Newest first" options={[{ value: 'relevance', label: 'Most relevant' }, { value: 'salary', label: 'Highest salary' }, { value: 'deadline', label: 'Closing soon' }]} aria-label="Sort" />
        <label className="checkbox" style={{ alignItems: 'center' }}><input type="checkbox" checked={value.remote === '1'} onChange={(e) => set('remote', e.target.checked ? '1' : '')} /> Remote only</label>
      </div>
    </div>
  );
}

function JobList({ path, emptyTitle, emptyText }: { path: string; emptyTitle: string; emptyText?: string }) {
  const list = usePaged(path);
  return (
    <div className="stack">
      {list.extra?.total != null && list.items.length > 0 && <div className="small muted">{list.extra.total} job{list.extra.total === 1 ? '' : 's'}</div>}
      {list.extra?.needs_location && <div className="card"><Empty icon="mapPin" title="Set your location">Add your city in <Link to="/settings/account">settings</Link> to see nearby jobs.</Empty></div>}
      {list.items.map((j: Json) => <JobCard key={j.id} j={j} match={j.match} />)}
      {!list.loading && !list.items.length && !list.extra?.needs_location && <div className="card"><Empty icon="briefcase" title={emptyTitle}>{emptyText}</Empty></div>}
      <LoadMore hasMore={list.hasMore} loading={list.loading} onClick={list.loadMore} />
    </div>
  );
}

export default function Jobs() {
  const { can } = useSession();
  const [params, setParams] = useSearchParams();
  const personal = can('apply_jobs');
  const tab = (params.get('tab') as Tab) ?? (personal ? 'recommended' : 'latest');
  const filters = Object.fromEntries([...params.entries()].filter(([k]) => k !== 'tab'));
  const hasFilters = Object.values(filters).some(Boolean);
  const setTab = (t: Tab) => setParams({ tab: t });

  const tabs: { id: Tab; label: string; icon: IconName }[] = [
    ...(personal ? [{ id: 'recommended' as Tab, label: 'Recommended', icon: 'sparkles' as const }] : []),
    { id: 'latest', label: hasFilters ? 'Search results' : 'Latest', icon: hasFilters ? 'search' : 'clock' },
    { id: 'nearby', label: 'Nearby', icon: 'mapPin' },
    { id: 'saved', label: 'Saved', icon: 'bookmark' },
    ...(personal ? [{ id: 'applied' as Tab, label: 'My applications', icon: 'send' as const }] : []),
  ];

  return (
    <main className="page page-mid">
      <PageTitle title="Jobs" subtitle="Opportunities matched to your skills, education and location." />
      <div className="stack">
        {(tab === 'latest' || tab === 'recommended') && (
          <Filters value={filters} onChange={(v) => setParams({ tab: 'latest', ...Object.fromEntries(Object.entries(v).filter(([, x]) => x)) })} />
        )}
        <Tabs tabs={tabs} value={tab} onChange={setTab} />
        {tab === 'recommended' && <JobList path="/jobs/recommended" emptyTitle="No recommendations yet" emptyText="Add skills, education and preferred locations to your CV to get matched." />}
        {tab === 'latest' && <JobList path={`/jobs${qs(filters)}`} emptyTitle="No jobs found" emptyText="Try removing some filters." />}
        {tab === 'nearby' && <JobList path="/jobs/nearby" emptyTitle="No jobs near you yet" />}
        {tab === 'saved' && <JobList path="/jobs/saved" emptyTitle="No saved jobs" emptyText="Tap the bookmark on any job to save it for later." />}
        {tab === 'applied' && <ApplicationsOverview />}
      </div>
    </main>
  );
}
