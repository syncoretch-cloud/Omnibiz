import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Icon } from '../components/Icon.tsx';
import { Avatar, Empty, Spinner, Verified } from '../components/ui.tsx';
import { ReportDialog } from '../components/Report.tsx';
import { get, post } from '../lib/api.ts';
import type { Json } from '../lib/api.ts';
import { useInterval } from '../lib/hooks.ts';
import { useSession, useToast } from '../lib/session.tsx';
import { parseTime, timeAgo } from '../lib/format.ts';

function Thread({ id, onSent }: { id: number; onSent: () => void }) {
  const { refresh } = useSession();
  const toast = useToast();
  const nav = useNavigate();
  const [conv, setConv] = useState<Json | null>(null);
  const [messages, setMessages] = useState<Json[]>([]);
  const [text, setText] = useState('');
  const [reporting, setReporting] = useState<number | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const lastId = messages.length ? messages[messages.length - 1].id : 0;

  useEffect(() => {
    setConv(null);
    setMessages([]);
    get(`/messages/conversations/${id}/messages`).then((r) => { setConv(r.conversation); setMessages(r.messages); refresh(); }).catch(() => nav('/messages'));
  }, [id, refresh, nav]);

  useInterval(() => {
    if (!conv) return;
    get(`/messages/conversations/${id}/messages?after=${lastId}`).then((r) => r.messages.length && setMessages((m) => [...m, ...r.messages])).catch(() => {});
  }, 5000);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [messages.length]);

  const send = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const body = text.trim();
    if (!body) return;
    setText('');
    try {
      const r = await post(`/messages/conversations/${id}/messages`, { body });
      setMessages((m) => [...m, r.message]);
      onSent();
    } catch (err) {
      setText(body);
      toast((err as Error).message, 'error');
    }
  };

  if (!conv) return <Spinner block />;
  const other = conv.participants[0];
  const ctx = conv.context;
  return (
    <>
      <div className="card-header">
        <div className="row">
          <Link to="/messages" className="btn btn-ghost btn-icon btn-sm thread-back" aria-label="Back"><Icon name="arrowLeft" /></Link>
          <Link to={`/u/${other?.username}`} className="row" style={{ color: 'inherit' }}>
            <Avatar user={other} size={36} />
            <div><div className="bold small row" style={{ gap: 4 }}>{other?.display_name}<Verified show={other?.verified} /></div><div className="xsmall muted">{other?.headline ?? other?.city}</div></div>
          </Link>
        </div>
      </div>
      {ctx?.type && (
        <Link to={ctx.type === 'job' ? `/jobs/${ctx.id}` : ctx.type === 'order' ? `/orders/${ctx.id}` : `/marketplace/${ctx.id}`} className="attachment-card" style={{ margin: '8px 16px 0' }}>
          <Icon name={ctx.type === 'job' ? 'briefcase' : ctx.type === 'order' ? 'package' : 'tag'} size={18} />
          <span className="small grow">About: <b>{ctx.title}</b></span>
          <Icon name="chevronRight" size={16} />
        </Link>
      )}
      <div className="messages-scroll" ref={scroller}>
        {messages.map((m, i) => {
          const showTime = i === 0 || parseTime(m.created_at).getTime() - parseTime(messages[i - 1].created_at).getTime() > 30 * 60_000;
          return (
            <div key={m.id} style={{ display: 'contents' }}>
              {showTime && <div className="center xsmall muted" style={{ margin: '8px 0' }}>{parseTime(m.created_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</div>}
              <div className={`bubble${m.mine ? ' mine' : ''}`} onDoubleClick={() => !m.mine && setReporting(m.id)} title={m.mine ? undefined : 'Double-click to report'}>
                {m.body}
              </div>
            </div>
          );
        })}
        {!messages.length && <div className="center muted small" style={{ margin: 'auto' }}>Say hello 👋</div>}
      </div>
      <form className="composer-bar" onSubmit={send}>
        <textarea
          className="textarea"
          rows={1}
          placeholder="Write a message…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          maxLength={4000}
        />
        <button className="btn btn-primary btn-icon" disabled={!text.trim()} aria-label="Send"><Icon name="send" /></button>
      </form>
      {reporting && <ReportDialog targetType="message" targetId={reporting} onClose={() => setReporting(null)} />}
    </>
  );
}

export default function Messages() {
  const { id } = useParams();
  const [convs, setConvs] = useState<Json[] | null>(null);
  const load = () => get('/messages/conversations').then((r) => setConvs(r.conversations)).catch(() => setConvs([]));
  useEffect(() => { load(); }, [id]);
  useInterval(load, 15000);
  const active = id ? Number(id) : null;

  return (
    <main className="page" style={{ paddingBottom: 20 }}>
      <div className={`card messenger${active ? ' has-thread' : ''}`}>
        <div className="threads">
          <div className="card-header"><h3>Messages</h3></div>
          {convs === null ? <Spinner block /> : !convs.length ? (
            <Empty icon="message" title="No conversations yet">Contact a business from its profile or product page.</Empty>
          ) : convs.map((c) => {
            const other = c.participants[0];
            return (
              <Link key={c.id} to={`/messages/${c.id}`} className={`list-item thread-item${active === c.id ? ' active' : ''}`}>
                <Avatar user={other} size={44} />
                <div className="grow">
                  <div className="row-between"><span className={`small truncate ${c.unread ? 'bold' : ''}`}>{other?.display_name}</span><span className="xsmall muted">{timeAgo(c.updated_at)}</span></div>
                  <div className={`xsmall truncate ${c.unread ? '' : 'muted'}`}>{c.context?.title ? `${c.context.title} · ` : ''}{c.last_message ?? 'No messages yet'}</div>
                </div>
                {c.unread > 0 && <span className="unread-dot" />}
              </Link>
            );
          })}
        </div>
        <div className="thread">
          {active ? <Thread key={active} id={active} onSent={load} /> : <Empty icon="message" title="Select a conversation">Your chats with businesses and people appear here.</Empty>}
        </div>
      </div>
    </main>
  );
}
