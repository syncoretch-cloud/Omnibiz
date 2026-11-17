import { Icon } from './Icon.tsx';
import { post } from '../lib/api.ts';
import { useAction } from '../lib/session.tsx';

/** "Alert me" for the search currently on screen: new matches arrive as notifications. */
export function SaveSearchButton({ kind, params }: { kind: 'product' | 'job'; params: Record<string, string> }) {
  const act = useAction();
  const clean = Object.fromEntries(Object.entries(params).filter(([k, v]) => v && !['sort', 'tab', 'posted_within', 'min_salary'].includes(k)));
  if (!Object.keys(clean).length) return null;
  return (
    <button className="btn btn-outline btn-sm" onClick={() => act(() => post('/saved-searches', { kind, params: clean }), 'Saved. We will tell you about new matches')}>
      <Icon name="bell" />Alert me about new ones
    </button>
  );
}
