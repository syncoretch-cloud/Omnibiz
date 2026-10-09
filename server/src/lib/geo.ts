// Location helpers. KNOWN_CITIES doubles as a lightweight geocoder for city names and
// as the place-name dictionary for natural-language search.

export const KNOWN_CITIES: Record<string, { lat: number; lng: number; country: string; region: string }> = {
  'Dar es Salaam': { lat: -6.7924, lng: 39.2083, country: 'Tanzania', region: 'Dar es Salaam' },
  Arusha: { lat: -3.3869, lng: 36.683, country: 'Tanzania', region: 'Arusha' },
  Dodoma: { lat: -6.163, lng: 35.7516, country: 'Tanzania', region: 'Dodoma' },
  Mwanza: { lat: -2.5164, lng: 32.9175, country: 'Tanzania', region: 'Mwanza' },
  Moshi: { lat: -3.3349, lng: 37.3404, country: 'Tanzania', region: 'Kilimanjaro' },
  Mbeya: { lat: -8.9094, lng: 33.4608, country: 'Tanzania', region: 'Mbeya' },
  Morogoro: { lat: -6.8278, lng: 37.6591, country: 'Tanzania', region: 'Morogoro' },
  Tanga: { lat: -5.0689, lng: 39.0988, country: 'Tanzania', region: 'Tanga' },
  Zanzibar: { lat: -6.1659, lng: 39.2026, country: 'Tanzania', region: 'Zanzibar' },
  Iringa: { lat: -7.7700, lng: 35.6930, country: 'Tanzania', region: 'Iringa' },
  Tabora: { lat: -5.0162, lng: 32.8266, country: 'Tanzania', region: 'Tabora' },
  Kigoma: { lat: -4.8769, lng: 29.6267, country: 'Tanzania', region: 'Kigoma' },
  Mtwara: { lat: -10.2736, lng: 40.1828, country: 'Tanzania', region: 'Mtwara' },
  Singida: { lat: -4.8163, lng: 34.7436, country: 'Tanzania', region: 'Singida' },
  Shinyanga: { lat: -3.6619, lng: 33.4232, country: 'Tanzania', region: 'Shinyanga' },
  Bukoba: { lat: -1.3317, lng: 31.8122, country: 'Tanzania', region: 'Kagera' },
  Musoma: { lat: -1.5, lng: 33.8, country: 'Tanzania', region: 'Mara' },
  Songea: { lat: -10.6833, lng: 35.65, country: 'Tanzania', region: 'Ruvuma' },
  Nairobi: { lat: -1.2921, lng: 36.8219, country: 'Kenya', region: 'Nairobi' },
  Mombasa: { lat: -4.0435, lng: 39.6682, country: 'Kenya', region: 'Mombasa' },
  Kampala: { lat: 0.3476, lng: 32.5825, country: 'Uganda', region: 'Central' },
  Kigali: { lat: -1.9441, lng: 30.0619, country: 'Rwanda', region: 'Kigali' },
};

export function cityCoords(city?: string | null): { lat: number; lng: number } | null {
  if (!city) return null;
  const key = Object.keys(KNOWN_CITIES).find((c) => c.toLowerCase() === city.trim().toLowerCase());
  return key ? { lat: KNOWN_CITIES[key].lat, lng: KNOWN_CITIES[key].lng } : null;
}

export function canonicalCity(city?: string | null): string | null {
  if (!city) return null;
  const t = city.trim();
  return Object.keys(KNOWN_CITIES).find((c) => c.toLowerCase() === t.toLowerCase()) ?? t;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Point = { lat: number; lng: number } | Record<string, any>;

export function distanceKm(a: Point, b: Point): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Bounding box for a cheap SQL prefilter before the exact distance check. */
export function boundingBox(lat: number, lng: number, radiusKm: number) {
  const dLat = radiusKm / 111;
  const dLng = radiusKm / (111 * Math.max(0.1, Math.cos((lat * Math.PI) / 180)));
  return { minLat: lat - dLat, maxLat: lat + dLat, minLng: lng - dLng, maxLng: lng + dLng };
}

/** Coarsens coordinates (~1 km) for users who have not opted into sharing a precise location. */
export function coarsen(lat: number | null, lng: number | null) {
  if (lat == null || lng == null) return { lat: null, lng: null };
  return { lat: Math.round(lat * 100) / 100, lng: Math.round(lng * 100) / 100 };
}
