// Small SVG chart kit: line chart with crosshair tooltip, labeled bar list, KPI tile.
// Colors come from --series-N tokens (validated for CVD separation in light & dark); text uses text tokens.
import { useMemo, useRef, useState } from 'react';
import { compact } from '../lib/format.ts';

export interface Series {
  name: string;
  values: number[];
}

// Two validated series (maroon + caramel); a third maroon/brown hue cannot be told apart reliably.
const SERIES_VARS = ['var(--series-1)', 'var(--series-2)'];

function niceMax(v: number) {
  if (v <= 4) return 4;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

const dayLabel = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

/** Line chart (max 2 series), one y-axis, legend + direct end labels + optional table view. */
export function LineChart({ days, series, height = 220, title }: { days: string[]; series: Series[]; height?: number; title: string }) {
  const W = 640;
  const H = height;
  const pad = { l: 36, r: 118, t: 12, b: 26 };
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const shown = series.slice(0, 2);
  const max = niceMax(Math.max(1, ...shown.flatMap((s) => s.values)));
  const x = (i: number) => pad.l + (i * (W - pad.l - pad.r)) / Math.max(1, days.length - 1);
  const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  const ticks = [0, max / 2, max];
  const labelEvery = Math.ceil(days.length / 6);

  // Direct end labels, nudged apart so they never overlap.
  const endLabels = useMemo(() => {
    const ls = shown.map((s, i) => ({ i, y: y(s.values[s.values.length - 1] ?? 0) }));
    ls.sort((a, b) => a.y - b.y);
    for (let k = 1; k < ls.length; k++) if (ls[k].y - ls[k - 1].y < 14) ls[k].y = ls[k - 1].y + 14;
    return new Map(ls.map((l) => [l.i, l.y]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, max]);

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const r = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (days.length - 1));
    setHover(Math.max(0, Math.min(days.length - 1, i)));
  };

  return (
    <div className="stack-sm">
      <div className="row-between">
        <div className="legend">
          {shown.map((s, i) => <span key={s.name}><i style={{ background: SERIES_VARS[i] }} />{s.name}</span>)}
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => setTable((t) => !t)} aria-pressed={table}>{table ? 'Chart' : 'Table'}</button>
      </div>
      {table ? (
        <div className="table-wrap" style={{ maxHeight: height + 20 }}>
          <table className="table">
            <thead><tr><th>Date</th>{shown.map((s) => <th key={s.name} className="num">{s.name}</th>)}</tr></thead>
            <tbody>{days.map((d, i) => <tr key={d}><td>{dayLabel(d)}</td>{shown.map((s) => <td key={s.name} className="num">{s.values[i]}</td>)}</tr>).reverse()}</tbody>
          </table>
        </div>
      ) : (
        <div ref={wrap} style={{ position: 'relative' }}>
          <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label={title}>
            {ticks.map((t) => (
              <g key={t}>
                <line className="grid-line" x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} />
                <text x={pad.l - 6} y={y(t) + 4} textAnchor="end">{compact(t)}</text>
              </g>
            ))}
            {days.map((d, i) => (i % labelEvery === 0 || i === days.length - 1) && (
              <text key={d} x={x(i)} y={H - 6} textAnchor="middle">{dayLabel(d)}</text>
            ))}
            {shown.map((s, si) => (
              <polyline key={s.name} fill="none" stroke={SERIES_VARS[si]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"
                points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')} />
            ))}
            {shown.map((s, si) => (
              <text key={s.name} x={W - pad.r + 8} y={(endLabels.get(si) ?? 0) + 4} style={{ fill: 'var(--text-2)', fontWeight: 600 }}>
                {s.name.length > 16 ? s.name.slice(0, 15) + '…' : s.name}
              </text>
            ))}
            {hover != null && (
              <g>
                <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} stroke="var(--border-strong)" strokeWidth={1} />
                {shown.map((s, si) => (
                  <circle key={s.name} cx={x(hover)} cy={y(s.values[hover] ?? 0)} r={4.5} fill={SERIES_VARS[si]} stroke="var(--surface)" strokeWidth={2} />
                ))}
              </g>
            )}
            <rect x={pad.l} y={pad.t} width={W - pad.l - pad.r} height={H - pad.t - pad.b} fill="transparent"
              onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
          </svg>
          {hover != null && (
            <div className="chart-tip" style={{ left: `${(x(hover) / W) * 100}%`, top: 8 }}>
              <div className="bold">{dayLabel(days[hover])}</div>
              {shown.map((s, si) => (
                <div key={s.name} className="row" style={{ gap: 6 }}>
                  <i style={{ width: 8, height: 8, borderRadius: 2, background: SERIES_VARS[si], display: 'inline-block' }} />
                  {s.name}: <b>{s.values[hover]}</b>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Ranked horizontal bars for one measure; value labels are always visible. */
export function BarList({ rows, valueLabel }: { rows: { label: React.ReactNode; value: number; key: string | number }[]; valueLabel?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <div className="small muted">No data yet.</div>;
  return (
    <div className="bar-list" role="list" aria-label={valueLabel}>
      {rows.map((r) => (
        <div key={r.key} className="bar-row" role="listitem" title={`${r.value} ${valueLabel ?? ''}`}>
          <div className="truncate">{r.label}</div>
          <div className="bar-track"><div className="bar-fill" style={{ width: `${(r.value / max) * 100}%`, background: 'var(--series-1)' }} /></div>
          <div className="num bold">{compact(r.value)}</div>
        </div>
      ))}
    </div>
  );
}

export function Kpi({ label, value, previous, format = compact }: { label: string; value: number; previous?: number; format?: (n: number) => string }) {
  let delta: React.ReactNode = null;
  if (previous !== undefined) {
    if (!previous) delta = value ? <span className="delta up">New</span> : <span className="delta muted">—</span>;
    else {
      const p = Math.round(((value - previous) / previous) * 100);
      delta = <span className={`delta ${p >= 0 ? 'up' : 'down'}`}>{p >= 0 ? '▲' : '▼'} {Math.abs(p) > 999 ? '>999' : Math.abs(p)}% <span className="muted" style={{ fontWeight: 400 }}>vs prev.</span></span>;
    }
  }
  return (
    <div className="card kpi">
      <div className="label">{label}</div>
      <div className="value">{format(value)}</div>
      {delta}
    </div>
  );
}
