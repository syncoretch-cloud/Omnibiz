import { useState } from 'react';
import { Field, Input, Select } from './ui.tsx';
import { useSession } from '../lib/session.tsx';

export interface Place { country: string; region: string; city: string }

const OTHER = '__other';

/**
 * Country, then region (a list when we have one for that country, typed otherwise), then city.
 * Picking a known city fills in its country and region.
 */
export function LocationFields({ value, onChange, labelled = false }: { value: Place; onChange: (p: Place) => void; labelled?: boolean }) {
  const { meta } = useSession();
  const countries = meta?.countries ?? [];
  const known = countries.find((c) => c.name === value.country);
  const [typedCountry, setTypedCountry] = useState(!!value.country && !known);

  const regions = known?.regions ?? null;
  // A region saved earlier that is not on the list is kept, so editing never silently drops it.
  const regionOptions = regions && value.region && !regions.includes(value.region) ? [value.region, ...regions] : regions;
  const cities = (meta?.cities ?? []).filter((c) => (!value.country || c.country === value.country) && (!value.region || c.region === value.region));

  const pickCountry = (v: string) => {
    if (v === OTHER) {
      setTypedCountry(true);
      onChange({ country: '', region: '', city: value.city });
      return;
    }
    setTypedCountry(false);
    const next = countries.find((c) => c.name === v);
    onChange({ country: v, region: next?.regions?.includes(value.region) ? value.region : '', city: value.city });
  };

  const pickCity = (city: string) => {
    const match = meta?.cities.find((c) => c.name.toLowerCase() === city.trim().toLowerCase());
    if (match) {
      setTypedCountry(false);
      onChange({ country: match.country, region: match.region, city: match.name });
    } else onChange({ ...value, city });
  };

  const wrap = (label: string, hint: string | undefined, control: React.ReactNode) => (labelled ? <Field label={label} hint={hint}>{control}</Field> : control);

  return (
    <>
      {wrap('Country', undefined, (
        <>
          <Select value={known ? value.country : typedCountry ? OTHER : ''} onChange={(e) => pickCountry(e.target.value)} placeholder="Country" options={[...countries.map((c) => c.name), { value: OTHER, label: 'Other country…' }].map((o) => (typeof o === 'string' ? { value: o, label: o } : o))} aria-label="Country" />
          {typedCountry && <Input style={{ marginTop: 8 }} placeholder="Country name" value={value.country} onChange={(e) => onChange({ ...value, country: e.target.value })} aria-label="Country name" />}
        </>
      ))}
      {wrap('Region', regions ? 'The region, county or province you live in.' : undefined, regionOptions
        ? <Select value={value.region} onChange={(e) => onChange({ ...value, region: e.target.value })} placeholder="Region" options={regionOptions} aria-label="Region" />
        : <Input placeholder="Region or province" value={value.region} onChange={(e) => onChange({ ...value, region: e.target.value })} aria-label="Region" />)}
      {wrap('City / town', undefined, (
        <>
          <Input placeholder="City or town (e.g. Arusha)" value={value.city} onChange={(e) => pickCity(e.target.value)} list="location-cities" aria-label="City or town" />
          <datalist id="location-cities">{cities.map((c) => <option key={c.name} value={c.name} />)}</datalist>
        </>
      ))}
    </>
  );
}
