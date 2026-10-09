import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Icon } from '../components/Icon.tsx';
import { BusinessCard } from '../components/Cards.tsx';
import { MapView, pinColor } from '../components/MapView.tsx';
import type { Pin } from '../components/MapView.tsx';
import { Empty, Input, LoadMore, PageTitle, Select } from '../components/ui.tsx';
import { usePaged, useDebounced } from '../lib/hooks.ts';
import { get, qs } from '../lib/api.ts';
import type { Json } from '../lib/api.ts';
import { useSession, useToast } from '../lib/session.tsx';

const KINDS = [
  { value: '', label: 'All' }, { value: 'company', label: 'Companies' }, { value: 'wholesaler', label: 'Wholesalers' }, { value: 'retailer', label: 'Retailers' },
];

function NearMap({ origin, category, layers }: { origin: { lat: number; lng: number }; category: string; layers: string[] }) {
  const nav = useNavigate();
  const [center, setCenter] = useState(origin);
  const [radius, setRadius] = useState(25);
  const dc = useDebounced(center, 400);
  const [pins, setPins] = useState<Json[]>([]);
  useEffect(() => {
    setCenter(origin);
  }, [origin]);
  useEffect(() => {
    get(`/businesses/map${qs({ lat: dc.lat, lng: dc.lng, radius: Math.ceil(radius), category, layers: layers.join(',') })}`).then((r) => setPins(r.pins)).catch(() => {});
  }, [dc, radius, category, layers]);
  const mapPins: Pin[] = useMemo(
    () => pins.map((p) => ({
      id: `${p.type}-${p.id}`, lat: p.lat, lng: p.lng, title: p.title,
      subtitle: `${p.type === 'job' ? 'Job · ' : ''}${p.subtitle ?? ''}${p.distance_km != null ? ` · ${p.distance_km} km` : ''}`,
      color: pinColor(p.type), letter: p.type === 'job' ? 'J' : p.type[0].toUpperCase(), z: p.type === 'job' ? 0 : 1000,
      // Jobs share their employer's coordinates; nudge them so both pins stay clickable.
      ...(p.type === 'job' ? { lat: p.lat + 0.0012, lng: p.lng + 0.0012 } : {}),
      href: p.type === 'job' ? `/jobs/${p.id}?src=map` : `/u/${p.username}?src=map`,
    })),
    [pins],
  );
  return (
    <div className="stack-sm">
      <MapView pins={mapPins} center={[origin.lat, origin.lng]} zoom={12} me={[origin.lat, origin.lng]} onOpen={(h) => nav(h)} onMove={(c) => { setCenter({ lat: c.lat, lng: c.lng }); setRadius(c.radiusKm); }} />
      <div className="legend">
        {[['company', 'Companies'], ['wholesaler', 'Wholesalers'], ['retailer', 'Retailers'], ['job', 'Jobs']].map(([k, l]) => <span key={k}><i style={{ background: pinColor(k) }} />{l}</span>)}
        <span className="muted">{pins.length} places in view</span>
      </div>
    </div>
  );
}

export default function Businesses() {
  const { me, meta } = useSession();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const view = params.get('view') ?? 'list';
  const kind = params.get('kind') ?? '';
  const category = params.get('category') ?? '';
  const city = params.get('city') ?? '';
  const q = params.get('q') ?? '';
  const [text, setText] = useState(q);
  const [near, setNear] = useState<{ lat: number; lng: number } | null>(null);
  const [layers, setLayers] = useState<string[]>(['company', 'wholesaler', 'retailer', 'jobs']);

  const set = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v); else p.delete(k);
    setParams(p);
  };

  const fallback = useMemo(() => {
    const u = me?.user;
    if (u?.lat != null) return { lat: u.lat, lng: u.lng };
    const c = meta?.cities.find((x) => x.name === u?.city) ?? meta?.cities[0];
    return c ? { lat: c.lat, lng: c.lng } : { lat: -6.7924, lng: 39.2083 };
  }, [me, meta]);

  const locate = () => {
    if (!navigator.geolocation) return toast('Location is not available on this device', 'error');
    // Precise location is only requested on explicit tap and never stored without the user's settings consent.
    navigator.geolocation.getCurrentPosition(
      (pos) => setNear({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {
        toast('Using your profile city instead of precise location', 'info');
        setNear(fallback);
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300_000 },
    );
  };

  const origin = near ?? fallback;
  const listPath = `/businesses${qs({ kind, category, city, q, verified: params.get('verified'), lat: near?.lat, lng: near?.lng, radius: near ? 50 : undefined })}`;
  const list = usePaged(view === 'list' ? listPath : null, 'businesses');

  return (
    <main className="page">
      <PageTitle
        title="Businesses"
        subtitle="Discover companies, wholesalers and retailers — near you or anywhere."
        actions={
          <>
            <button className={`btn btn-sm ${view === 'list' ? 'btn-primary' : 'btn-outline'}`} onClick={() => set('view', '')}><Icon name="grid" />List</button>
            <button className={`btn btn-sm ${view === 'map' ? 'btn-primary' : 'btn-outline'}`} onClick={() => set('view', 'map')}><Icon name="map" />Map</button>
          </>
        }
      />
      <div className="stack">
        <div className="card card-pad stack-sm">
          <form className="row" onSubmit={(e) => { e.preventDefault(); set('q', text); }}>
            <div className="input-icon grow"><Icon name="search" /><Input placeholder="Search businesses or services, e.g. “solar installation”" value={text} onChange={(e) => setText(e.target.value)} /></div>
            <button className="btn btn-primary">Search</button>
          </form>
          <div className="row-wrap">
            <div className="filter-bar">
              {KINDS.map((k) => <button key={k.value} className={`chip${kind === k.value ? ' active' : ''}`} onClick={() => set('kind', k.value)}>{k.label}</button>)}
            </div>
            <Select value={category} onChange={(e) => set('category', e.target.value)} placeholder="All categories" options={(meta?.industries ?? []).map((c) => ({ value: c.slug, label: c.name }))} style={{ width: 'auto' }} aria-label="Category" />
            {view === 'list' && <Select value={city} onChange={(e) => set('city', e.target.value)} placeholder="All cities" options={(meta?.cities ?? []).map((c) => c.name)} style={{ width: 'auto' }} aria-label="City" />}
            {view === 'list' && <label className="checkbox"><input type="checkbox" checked={params.get('verified') === '1'} onChange={(e) => set('verified', e.target.checked ? '1' : '')} />Verified only</label>}
            <button className={`btn btn-sm ${near ? 'btn-primary' : 'btn-brand-outline'}`} onClick={near ? () => setNear(null) : locate}><Icon name="target" />{near ? 'Near me ✓' : 'Near me'}</button>
          </div>
          {view === 'map' && (
            <div className="row-wrap small">
              <span className="muted">Show:</span>
              {[['company', 'Companies'], ['wholesaler', 'Wholesalers'], ['retailer', 'Retailers'], ['jobs', 'Jobs']].map(([k, l]) => (
                <label key={k} className="checkbox"><input type="checkbox" checked={layers.includes(k)} onChange={(e) => setLayers((x) => (e.target.checked ? [...x, k] : x.filter((y) => y !== k)))} />{l}</label>
              ))}
            </div>
          )}
        </div>

        {view === 'map' ? (
          <NearMap origin={origin} category={category} layers={layers} />
        ) : (
          <>
            {list.extra?.total != null && <div className="small muted">{list.extra.total} business{list.extra.total === 1 ? '' : 'es'}{near ? ' within 50 km' : ''}</div>}
            <div className="grid-3">{list.items.map((b: Json) => <BusinessCard key={b.id} b={b} />)}</div>
            {!list.loading && !list.items.length && <div className="card"><Empty icon="building" title="No businesses found">Try a different category or location.</Empty></div>}
            <LoadMore hasMore={list.hasMore} loading={list.loading} onClick={list.loadMore} />
          </>
        )}
      </div>
    </main>
  );
}
