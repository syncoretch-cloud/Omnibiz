import { useEffect } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Icon } from '../components/Icon.tsx';
import { Avatar, Empty, LoadMore, PageTitle, Swap, Tabs } from '../components/ui.tsx';
import { post } from '../lib/api.ts';
import type { Json } from '../lib/api.ts';
import { usePaged } from '../lib/hooks.ts';
import { useSession } from '../lib/session.tsx';
import { parseTime, timeAgo } from '../lib/format.ts';

const ICONS: Record<string, string> = {
  job_match: 'target', hiring: 'briefcase', application: 'file', application_update: 'briefcase', announcement: 'megaphone',
  new_product: 'bag', order: 'package', follow: 'users', like: 'heart', comment: 'comment', mention: 'hash', repost: 'repeat',
  security: 'shield', verification: 'shieldCheck', moderation: 'flag', system: 'info',
};
const GROUPS = ['', 'jobs', 'business', 'social', 'system'];

function section(n: Json): string {
  if (!n.read_at) return 'New';
  const days = (Date.now() - parseTime(n.created_at).getTime()) / 86_400_000;
  if (days < 1) return 'Today';
  if (days < 7) return 'This week';
  if (days < 30) return 'This month';
  return 'Earlier';
}

export default function Notifications() {
  const { refresh } = useSession();
  const [params, setParams] = useSearchParams();
  const group = params.get('group') ?? '';
  const list = usePaged(`/notifications${group ? `?group=${group}` : ''}`);

  // Opening the page marks visible notifications read (after a beat, so they still render as new).
  useEffect(() => {
    const unread = list.items.filter((n: Json) => !n.read_at).map((n: Json) => n.id);
    if (!unread.length) return;
    const t = setTimeout(() => post('/notifications/read', { ids: unread }).then(refresh).catch(() => {}), 2500);
    return () => clearTimeout(t);
  }, [list.items, refresh]);

  const rows: (Json | string)[] = [];
  let last = '';
  for (const n of list.items) {
    const s = section(n);
    if (s !== last) { rows.push(s); last = s; }
    rows.push(n);
  }

  return (
    <main className="page page-narrow">
      <PageTitle
        title="Notifications"
        actions={<button className="btn btn-sm" onClick={async () => { await post('/notifications/read', { all: true }); refresh(); list.reload(); }}><Icon name="check" />Mark all read</button>}
      />
      <div className="stack">
        <Tabs
          tabs={[{ id: '', label: 'All' }, { id: 'jobs', label: 'Jobs' }, { id: 'business', label: 'Business' }, { id: 'social', label: 'Social' }, { id: 'system', label: 'Account' }]}
          value={group}
          onChange={(g) => setParams(g ? { group: g } : {}, { replace: true })}
        />
        <Swap k={group} order={GROUPS}>
          <div className="card" style={{ paddingBottom: 8 }}>
            {rows.map((r) => {
              if (typeof r === 'string') return <div key={`h-${r}`} className="notif-group">{r}</div>;
              const n = r;
              const href = n.link && /^\/jobs\/\d+$/.test(n.link) ? `${n.link}?src=notification` : n.link;
              const body = (
                <>
                  {n.actor ? (
                    <div style={{ position: 'relative' }}>
                      <Avatar user={n.actor} size={44} />
                      <span className="notif-icon" style={{ position: 'absolute', right: -4, bottom: -4, width: 22, height: 22, border: '2px solid var(--surface)' }}><Icon name={ICONS[n.type] ?? 'bell'} size={11} /></span>
                    </div>
                  ) : <div className="notif-icon"><Icon name={ICONS[n.type] ?? 'bell'} /></div>}
                  <div className="grow small" style={{ lineHeight: 1.4 }}>
                    <b>{n.title}</b>
                    {n.body && <span className="muted"> {n.body}</span>}
                    <span className="muted xsmall"> · {timeAgo(n.created_at)}</span>
                  </div>
                  {!n.read_at && <span className="unread-dot" />}
                </>
              );
              return href
                ? <Link key={n.id} to={href} className={`notif${n.read_at ? '' : ' unread'}`}>{body}</Link>
                : <div key={n.id} className={`notif${n.read_at ? '' : ' unread'}`}>{body}</div>;
            })}
            {!list.loading && !list.items.length && <Empty icon="bell" title="You're all caught up">Job matches, business updates and activity will appear here.</Empty>}
            <div style={{ padding: 12 }}><LoadMore hasMore={list.hasMore} loading={list.loading} onClick={list.loadMore} /></div>
          </div>
        </Swap>
      </div>
    </main>
  );
}
