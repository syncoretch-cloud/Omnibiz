import { useEffect, useRef } from 'react';
import L from 'leaflet';

export interface Pin {
  id: string | number;
  lat: number;
  lng: number;
  title: string;
  subtitle?: string;
  color?: string;
  letter?: string;
  href?: string;
  /** Higher draws on top (e.g. businesses above the jobs they post). */
  z?: number;
}

// Pins also carry a letter (C/W/R/J), so close maroon/brown shades stay distinguishable.
const COLORS: Record<string, string> = { company: '#6d324f', wholesaler: '#b85c4a', retailer: '#80616f', job: '#1c1e3a', product: '#40263a' };
export const pinColor = (type: string) => COLORS[type] ?? '#0f766e';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * Leaflet map with OpenStreetMap tiles. Pins navigate via `onOpen`; `pick` mode lets businesses
 * set their physical location by clicking or dragging a marker.
 */
export function MapView({
  pins = [], center, zoom = 12, me, onOpen, onMove, pick, className = 'map',
}: {
  pins?: Pin[];
  center: [number, number];
  zoom?: number;
  me?: [number, number] | null;
  onOpen?: (href: string) => void;
  onMove?: (c: { lat: number; lng: number; radiusKm: number }) => void;
  pick?: { value: [number, number] | null; onChange: (lat: number, lng: number) => void };
  className?: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const pickMarker = useRef<L.Marker | null>(null);
  const cbs = useRef({ onOpen, onMove, pick });
  cbs.current = { onOpen, onMove, pick };

  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, { zoomControl: true, attributionControl: true }).setView(center, zoom);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(m);
    layer.current = L.layerGroup().addTo(m);
    m.on('moveend', () => {
      const c = m.getCenter();
      const b = m.getBounds();
      cbs.current.onMove?.({ lat: c.lat, lng: c.lng, radiusKm: Math.max(1, c.distanceTo(b.getNorthEast()) / 1000) });
    });
    m.on('click', (e: L.LeafletMouseEvent) => cbs.current.pick?.onChange(e.latlng.lat, e.latlng.lng));
    el.current.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest('a[data-href]') as HTMLAnchorElement | null;
      if (a) {
        e.preventDefault();
        cbs.current.onOpen?.(a.dataset.href!);
      }
    });
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    map.current?.setView(center, map.current.getZoom() < 6 ? zoom : map.current.getZoom());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center[0], center[1]]);

  useEffect(() => {
    const g = layer.current;
    if (!g) return;
    g.clearLayers();
    for (const p of pins) {
      const icon = L.divIcon({
        className: '',
        html: `<div class="pin" style="background:${p.color ?? '#0f766e'}"><span>${esc(p.letter ?? '')}</span></div>`,
        iconSize: [30, 30],
        iconAnchor: [15, 30],
        popupAnchor: [0, -28],
      });
      const html = `<div style="min-width:160px"><b>${esc(p.title)}</b>${p.subtitle ? `<div style="color:#666;font-size:12px">${esc(p.subtitle)}</div>` : ''}${p.href ? `<a href="${p.href}" data-href="${p.href}" style="font-size:13px;font-weight:600">Open →</a>` : ''}</div>`;
      L.marker([p.lat, p.lng], { icon, title: p.title, zIndexOffset: p.z ?? 0 }).bindPopup(html).addTo(g);
    }
    if (me) L.marker(me, { icon: L.divIcon({ className: '', html: '<div class="pin-me"></div>', iconSize: [16, 16] }), title: 'You' }).addTo(g);
  }, [pins, me]);

  useEffect(() => {
    const m = map.current;
    if (!m || !pick) return;
    if (pick.value) {
      if (!pickMarker.current) {
        pickMarker.current = L.marker(pick.value, {
          draggable: true,
          icon: L.divIcon({ className: '', html: '<div class="pin" style="background:#dc2626"><span>●</span></div>', iconSize: [30, 30], iconAnchor: [15, 30] }),
        }).addTo(m);
        pickMarker.current.on('dragend', () => {
          const ll = pickMarker.current!.getLatLng();
          cbs.current.pick?.onChange(ll.lat, ll.lng);
        });
      } else pickMarker.current.setLatLng(pick.value);
    }
  }, [pick?.value?.[0], pick?.value?.[1]]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={el} className={className} />;
}
