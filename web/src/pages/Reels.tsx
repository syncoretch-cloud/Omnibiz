import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Icon } from '../components/Icon.tsx';
import { Artwork, jobArt, postArt, productArt } from '../components/Artwork.tsx';
import { Avatar, Empty, Portal, Spinner, Verified } from '../components/ui.tsx';
import { CommentsList, RichText } from '../components/PostCard.tsx';
import { del, post } from '../lib/api.ts';
import type { Json } from '../lib/api.ts';
import { usePaged } from '../lib/hooks.ts';
import { useAction, useSession, useToast } from '../lib/session.tsx';
import { compact, money, salary, timeAgo } from '../lib/format.ts';

function ActionButton({ icon, label, on, pop, onClick, fill }: { icon: string; label?: string; on?: boolean; pop?: boolean; fill?: boolean; onClick: () => void }) {
  return (
    <button className={`reel-act${on ? ' on' : ''}${pop ? ' pop' : ''}`} onClick={onClick} aria-pressed={on}>
      <span className="bubble-btn"><Icon name={icon} fill={fill} /></span>
      {label != null && <span>{label}</span>}
    </button>
  );
}

function FollowPill({ user }: { user: Json }) {
  const { me, can } = useSession();
  const act = useAction();
  const [done, setDone] = useState(false);
  if (!user || user.id === me?.user.id || !can('follow')) return null;
  return (
    <button className="btn btn-glass btn-sm" style={{ height: 28, padding: '0 12px' }} disabled={done} onClick={async () => { if (await act(() => post(`/users/${user.id}/follow`))) setDone(true); }}>
      {done ? 'Following' : 'Follow'}
    </button>
  );
}

function Reel({ item, active, onComments }: { item: Json; active: boolean; onComments: (p: Json) => void }) {
  const { can, refresh } = useSession();
  const act = useAction();
  const toast = useToast();
  const nav = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [p, setP] = useState(item.post ?? item.product ?? item.job);
  const [burst, setBurst] = useState(0);
  const [pop, setPop] = useState(false);
  const [open, setOpen] = useState(false);
  const type = item.type as 'post' | 'product' | 'job';

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (active) v.play().catch(() => {});
    else v.pause();
  }, [active]);

  const share = async (path: string) => {
    const url = `${location.origin}${path}`;
    if (navigator.share) navigator.share({ url, title: 'OmniBiz' }).catch(() => {});
    else { await navigator.clipboard?.writeText(url); toast('Link copied', 'success'); }
  };
  const save = async (target: string) => {
    const saved = !p.saved;
    setP({ ...p, saved });
    await act(() => (saved ? post('/saves', { target_type: target, target_id: p.id }) : del('/saves', { target_type: target, target_id: p.id })), saved ? 'Saved' : undefined);
  };
  const like = async () => {
    const liked = !p.liked;
    setP({ ...p, liked, like_count: p.like_count + (liked ? 1 : -1) });
    if (liked) { setPop(true); setTimeout(() => setPop(false), 500); }
    await act(() => (liked ? post(`/posts/${p.id}/like`) : del(`/posts/${p.id}/like`)));
  };
  const doubleTap = () => {
    setBurst(Date.now());
    if (type === 'post' && !p.liked && can('interact')) like();
    if (type === 'product' && !p.saved && can('save')) save('product');
  };
  const message = async (userId: number, context: Json) => {
    const r = await act(() => post('/messages/start', { user_id: userId, context }));
    if (r) nav(`/messages/${r.conversation_id}`);
  };

  const author = type === 'post' ? p.author : type === 'product' ? p.seller : p.company;
  const media = type === 'post' ? p.media?.[0] : type === 'product' ? p.media?.[0] : undefined;
  const art = type === 'post' ? postArt(p) : type === 'product' ? productArt(p, false) : jobArt(p);
  const href = type === 'post' ? `/posts/${p.id}` : type === 'product' ? `/marketplace/${p.id}?src=reels` : `/jobs/${p.id}?src=reels`;

  return (
    <section className="reel" data-key={item.key}>
      <div className={`reel-card${active ? ' entering' : ''}`} onDoubleClick={doubleTap}>
        {media ? (/\.(mp4|webm)$/i.test(media) ? <video ref={videoRef} src={media} loop muted playsInline /> : <img src={media} alt="" />) : <Artwork variant="reel" {...art} />}
        <div className="reel-type">
          <span className="reel-title">Reels</span>
          <span className="chip" style={{ background: 'rgba(255,245,235,.16)', color: '#fff6ee', boxShadow: 'none', borderColor: 'rgba(255,245,235,.3)' }}>
            <Icon name={type === 'post' ? 'reels' : type === 'product' ? 'bag' : 'briefcase'} />{type === 'post' ? 'Post' : type === 'product' ? 'Shop' : 'Job'}
          </span>
        </div>
        {burst > 0 && <div key={burst} className="heart-burst"><Icon name={type === 'job' ? 'bookmark' : 'heart'} fill /></div>}
        <div className="reel-info">
          <div className="who">
            <Link to={`/u/${author?.username}`}><Avatar user={author} size={36} /></Link>
            <Link to={`/u/${author?.username}`} className="truncate">{author?.username}</Link>
            <Verified show={author?.verified} />
            <FollowPill user={author} />
          </div>
          {type === 'post' && (p.body || media) && (
            <div className={`caption${open ? '' : ' clamp-2'}`} onClick={() => setOpen((o) => !o)}><RichText text={p.body} /></div>
          )}
          {type === 'product' && (
            <>
              {media && <div className="caption bold">{p.name}</div>}
              <div className="row-wrap">
                <Link to={href} className="btn btn-glass btn-sm"><Icon name="eye" />View</Link>
                {can('purchase') && p.sale_type !== 'service' && p.availability !== 'out_of_stock' && (
                  <button className="btn btn-primary btn-sm" onClick={async () => { if (await act(() => post('/cart', { product_id: p.id, qty: p.min_order_qty }), 'Added to cart')) refresh(); }}>
                    <Icon name="cart" />Add · {money(p.price * p.min_order_qty, p.currency)}
                  </button>
                )}
              </div>
            </>
          )}
          {type === 'job' && (
            <div className="row-wrap">
              <Link to={href} className="btn btn-primary btn-sm"><Icon name="send" />{p.application_stage ? 'View application' : 'Apply'}</Link>
              <span className="chip" style={{ background: 'rgba(255,245,235,.16)', color: '#fff6ee', boxShadow: 'none', borderColor: 'rgba(255,245,235,.3)' }}>{salary(p)}</span>
            </div>
          )}
          <div className="meta">
            <Icon name="music" />
            <div className="marquee"><span>{author?.display_name} · {type === 'post' ? 'Original' : type === 'product' ? (p.city ?? 'Shop') : (p.remote ? 'Remote' : p.city)} · {timeAgo(p.created_at)}</span></div>
          </div>
        </div>
      </div>
      <div className="reel-actions">
        {type === 'post' && (
          <>
            {can('interact') && <ActionButton icon="heart" fill={p.liked} on={p.liked} pop={pop} label={compact(p.like_count)} onClick={like} />}
            <ActionButton icon="comment" label={compact(p.comment_count)} onClick={() => onComments(p)} />
            <ActionButton icon="send" label="Share" onClick={() => share(href)} />
            {can('save') && <ActionButton icon="bookmark" fill={p.saved} on={p.saved} onClick={() => save('post')} />}
          </>
        )}
        {type === 'product' && (
          <>
            {can('save') && <ActionButton icon="heart" fill={p.saved} on={p.saved} label={p.saved ? 'Saved' : 'Save'} onClick={() => save('product')} />}
            {can('message') && <ActionButton icon="message" label="Ask" onClick={() => message(p.seller.id, { type: 'product', id: p.id, title: p.name })} />}
            <ActionButton icon="send" label="Share" onClick={() => share(href)} />
          </>
        )}
        {type === 'job' && (
          <>
            {can('save') && <ActionButton icon="bookmark" fill={p.saved} on={p.saved} label={p.saved ? 'Saved' : 'Save'} onClick={() => save('job')} />}
            {can('message') && <ActionButton icon="message" label="Ask" onClick={() => message(p.company.id, { type: 'job', id: p.id, title: p.title })} />}
            <ActionButton icon="send" label="Share" onClick={() => share(href)} />
          </>
        )}
        <Link to={`/u/${author?.username}`} className="reel-act" aria-label="Profile"><Avatar user={author} size={40} /></Link>
      </div>
    </section>
  );
}

export default function Reels() {
  const [params] = useSearchParams();
  const start = params.get('start');
  const list = usePaged(`/reels${start ? `?start=${encodeURIComponent(start)}` : ''}`);
  const { items, hasMore, loading, loadMore } = list;
  const scroller = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [comments, setComments] = useState<Json | null>(null);
  const [added, setAdded] = useState<Json[]>([]);
  const [text, setText] = useState('');
  const act = useAction();
  const { can } = useSession();

  // Track the reel in view; prefetch when nearing the end.
  useEffect(() => {
    const root = scroller.current;
    if (!root) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            const i = Number((e.target as HTMLElement).dataset.index);
            setActive(i);
            if (i >= items.length - 3 && hasMore && !loading) loadMore();
          }
        }
      },
      { root, threshold: 0.6 },
    );
    root.querySelectorAll<HTMLElement>('.reel').forEach((el, i) => { el.dataset.index = String(i); io.observe(el); });
    return () => io.disconnect();
  }, [items.length, hasMore, loading, loadMore]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea')) return;
      const el = scroller.current;
      if (!el) return;
      if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); el.scrollBy({ top: el.clientHeight, behavior: 'smooth' }); }
      if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); el.scrollBy({ top: -el.clientHeight, behavior: 'smooth' }); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const sendComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!comments || !text.trim()) return;
    const r = await act(() => post(`/posts/${comments.id}/comments`, { body: text }));
    if (r) { setAdded((a) => [...a, r.comment]); setText(''); }
  };

  return (
    <>
      <div className="reels" ref={scroller}>
        {items.map((it, i) => <Reel key={it.key} item={it} active={i === active} onComments={(p) => { setAdded([]); setComments(p); }} />)}
        {loading && !items.length && <div className="reel"><Spinner /></div>}
        {!loading && !items.length && <div className="reel"><div className="card"><Empty icon="reels" title="No reels yet">Follow businesses and people to fill your reels.</Empty></div></div>}
      </div>
      {comments && (
        <Portal>
          <div className="modal-backdrop" style={{ background: 'transparent', backdropFilter: 'none' }} onMouseDown={(e) => e.target === e.currentTarget && setComments(null)}>
            <div className="reel-sheet glass" role="dialog" aria-label="Comments">
              <div className="modal-head"><h3>Comments</h3><button className="icon-btn" onClick={() => setComments(null)} aria-label="Close"><Icon name="x" /></button></div>
              <div className="sheet-body"><CommentsList postId={comments.id} added={added} onCount={() => {}} /></div>
              {can('interact') && (
                <form className="composer-bar" onSubmit={sendComment}>
                  <input className="input search-input" placeholder="Add a comment…" value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} autoFocus />
                  <button className="btn btn-primary btn-icon" disabled={!text.trim()} aria-label="Post comment"><Icon name="send" /></button>
                </form>
              )}
            </div>
          </div>
        </Portal>
      )}
    </>
  );
}
