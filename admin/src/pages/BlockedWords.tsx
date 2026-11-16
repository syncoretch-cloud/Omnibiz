import { useState } from 'react';
import { Empty, Input, Select, Spinner } from '@web/components/ui.tsx';
import { del, post } from '@web/lib/api.ts';
import type { Json } from '@web/lib/api.ts';
import { useApi } from '@web/lib/hooks.ts';
import { useAction } from '@web/lib/session.tsx';

const TIERS: { id: 'block' | 'review'; title: string; hint: string }[] = [
  { id: 'block', title: 'Blocked outright', hint: 'The post, comment, product or job is rejected and the person is asked to change it. Explicit sexual content, slurs and child-abuse terms.' },
  { id: 'review', title: 'Held for review', hint: 'It is saved but hidden until a moderator releases or removes it, under Content → Flagged. Profanity and words that are only sometimes a problem.' },
];

/** The word lists behind automatic moderation. Whole words, any letter case; look-alikes such as "p0rn" and stretched letters are caught too. */
export function BlockedWords() {
  const act = useAction();
  const { data, loading, reload } = useApi('/admin/moderation/terms');
  const [term, setTerm] = useState('');
  const [action, setAction] = useState<'block' | 'review'>('block');
  const [filter, setFilter] = useState('');
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!term.trim()) return;
    if (await act(() => post('/admin/moderation/terms', { term, action }), 'Saved')) { setTerm(''); reload(); }
  };
  const items: Json[] = (data?.items ?? []).filter((t: Json) => !filter || t.term.includes(filter.toLowerCase()));
  return (
    <div className="stack">
      <div className="card card-pad stack">
        <div>
          <h3>Blocked words</h3>
          <p className="small muted">Checked on every new post, comment, product, job and bio. {data ? `${data.counts.block} blocked outright, ${data.counts.review} held for review.` : ''} Adding a word that is already listed moves it to the other list.</p>
        </div>
        <form className="row-wrap" onSubmit={add}>
          <Input className="grow" placeholder="Add a word or phrase" value={term} onChange={(e) => setTerm(e.target.value)} maxLength={60} />
          <Select value={action} onChange={(e) => setAction(e.target.value as 'block' | 'review')} options={[{ value: 'block', label: 'Block outright' }, { value: 'review', label: 'Hold for review' }]} style={{ width: 'auto' }} />
          <button className="btn btn-primary">Add</button>
        </form>
        <Input placeholder="Filter the lists" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      {loading && !data ? <Spinner block /> : TIERS.map((tier) => {
        const list = items.filter((t) => t.action === tier.id);
        return (
          <div key={tier.id} className="card card-pad stack">
            <div><h3>{tier.title} <span className="muted small">({list.length})</span></h3><p className="small muted">{tier.hint}</p></div>
            <div className="chips">
              {list.map((t) => (
                <span key={t.term} className="chip">{t.term}
                  <button className="chip-x" title={tier.id === 'block' ? 'Hold for review instead' : 'Block outright instead'} aria-label={`Move ${t.term}`} onClick={async () => { if (await act(() => post('/admin/moderation/terms', { term: t.term, action: tier.id === 'block' ? 'review' : 'block' }))) reload(); }}>⇄</button>
                  <button className="chip-x" aria-label={`Remove ${t.term}`} onClick={async () => { if (await act(() => del(`/admin/moderation/terms/${encodeURIComponent(t.term)}`))) reload(); }}>×</button>
                </span>
              ))}
            </div>
            {!list.length && <Empty title="Nothing here" />}
          </div>
        );
      })}
    </div>
  );
}
