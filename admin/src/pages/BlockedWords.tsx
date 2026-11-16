import { useState } from 'react';
import { Empty, Input, Spinner } from '@web/components/ui.tsx';
import { del, post } from '@web/lib/api.ts';
import type { Json } from '@web/lib/api.ts';
import { useApi } from '@web/lib/hooks.ts';
import { useAction } from '@web/lib/session.tsx';

/** Words that hold a new post for review. Matches whole words, any letter case. */
export function BlockedWords() {
  const act = useAction();
  const { data, loading, reload } = useApi('/admin/moderation/terms');
  const [term, setTerm] = useState('');
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!term.trim()) return;
    if (await act(() => post('/admin/moderation/terms', { term }), 'Added')) { setTerm(''); reload(); }
  };
  return (
    <div className="stack">
      <div className="card card-pad stack">
        <div>
          <h3>Blocked words</h3>
          <p className="small muted">A new post containing one of these is not published. It is held under Content → Flagged until a moderator restores or removes it, and its author is told it is under review.</p>
        </div>
        <form className="row-wrap" onSubmit={add}>
          <Input className="grow" placeholder="Add a word or phrase" value={term} onChange={(e) => setTerm(e.target.value)} maxLength={60} />
          <button className="btn btn-primary">Add</button>
        </form>
      </div>
      {loading && !data ? <Spinner block /> : (
        <div className="card card-pad">
          <div className="chips">
            {data?.items.map((t: Json) => (
              <span key={t.term} className="chip">{t.term}
                <button className="chip-x" aria-label={`Remove ${t.term}`} onClick={async () => { if (await act(() => del(`/admin/moderation/terms/${encodeURIComponent(t.term)}`))) reload(); }}>×</button>
              </span>
            ))}
          </div>
          {!data?.items.length && <Empty title="No blocked words" />}
        </div>
      )}
    </div>
  );
}
