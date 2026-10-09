import { Fragment, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Icon } from './Icon.tsx';
import { Artwork, postArt } from './Artwork.tsx';
import { Avatar, Dropdown, Verified } from './ui.tsx';
import { ReportDialog } from './Report.tsx';
import { del, get, post } from '../lib/api.ts';
import type { Json } from '../lib/api.ts';
import { useAction, useSession, useToast } from '../lib/session.tsx';
import { ACCOUNT_LABEL, dateLabel, timeAgo } from '../lib/format.ts';

/** Renders text with clickable #hashtags, @mentions and links. */
export function RichText({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  const re = /(#[\p{L}\p{N}_]{2,40}|@[a-zA-Z0-9_.]{3,30}|https?:\/\/[^\s]+)/gu;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith('#')) parts.push(<Link key={i++} to={`/search?q=${encodeURIComponent(t)}&type=posts`}>{t}</Link>);
    else if (t.startsWith('@')) parts.push(<Link key={i++} to={`/u/${t.slice(1)}`}>{t}</Link>);
    else parts.push(<a key={i++} href={t} target="_blank" rel="noopener noreferrer nofollow">{t.length > 50 ? t.slice(0, 47) + '…' : t}</a>);
    last = m.index + t.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts.map((p, k) => <Fragment key={k}>{p}</Fragment>)}</>;
}

export function MediaGrid({ media }: { media: string[] }) {
  if (!media?.length) return null;
  const shown = media.slice(0, 4);
  return (
    <div className={`media-grid n${shown.length}`}>
      {shown.map((m, i) =>
        /\.(mp4|webm)$/i.test(m) ? (
          <video key={m} src={m} controls preload="metadata" style={shown.length === 3 && i === 0 ? { gridRow: 'span 2' } : undefined} />
        ) : (
          <img key={m} src={m} alt="" loading="lazy" style={shown.length === 3 && i === 0 ? { gridRow: 'span 2' } : undefined} />
        ),
      )}
    </div>
  );
}

export function Carousel({ media }: { media: string[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [i, setI] = useState(0);
  const go = (d: number) => ref.current?.scrollTo({ left: (i + d) * ref.current.clientWidth, behavior: 'smooth' });
  return (
    <>
      <div className="carousel" ref={ref} onScroll={(e) => setI(Math.round(e.currentTarget.scrollLeft / e.currentTarget.clientWidth))}>
        {media.map((m) => (/\.(mp4|webm)$/i.test(m) ? <video key={m} src={m} controls preload="metadata" /> : <img key={m} src={m} alt="" loading="lazy" draggable={false} />))}
      </div>
      {media.length > 1 && (
        <>
          {i > 0 && <button className="carousel-btn" style={{ left: 10 }} onClick={() => go(-1)} aria-label="Previous"><Icon name="chevronLeft" /></button>}
          {i < media.length - 1 && <button className="carousel-btn" style={{ right: 10 }} onClick={() => go(1)} aria-label="Next"><Icon name="chevronRight" /></button>}
          <div className="carousel-dots">{media.map((m, k) => <i key={m} className={k === i ? 'on' : ''} />)}</div>
        </>
      )}
    </>
  );
}

export function CommentsList({ postId, added, onCount }: { postId: number; added: Json[]; onCount: (d: number) => void }) {
  const act = useAction();
  const [items, setItems] = useState<Json[] | null>(null);
  useEffect(() => {
    get(`/posts/${postId}/comments`).then((r) => setItems(r.comments)).catch(() => setItems([]));
  }, [postId]);
  const all = [...(items ?? []), ...added.filter((a) => !items?.some((c) => c.id === a.id))];
  const remove = async (id: number) => {
    if (await act(() => del(`/posts/comments/${id}`))) {
      setItems((c) => (c ?? []).filter((x) => x.id !== id));
      onCount(-1);
    }
  };
  if (items === null) return <div className="muted small" style={{ padding: '6px 0' }}>Loading comments…</div>;
  if (!all.length) return <div className="muted small" style={{ padding: '6px 0' }}>No comments yet — start the conversation.</div>;
  return (
    <div className="stagger">
      {all.map((c) => (
        <div key={c.id} className="comment">
          <Link to={`/u/${c.author?.username}`}><Avatar user={c.author} size={30} /></Link>
          <div className="comment-bubble">
            <div className="row-between">
              <div className="small"><Link to={`/u/${c.author?.username}`} className="bold" style={{ color: 'var(--text)' }}>{c.author?.display_name}</Link> <span className="muted xsmall">· {timeAgo(c.created_at)}</span></div>
              {c.mine && <button className="icon-btn" style={{ padding: 2 }} onClick={() => remove(c.id)} aria-label="Delete comment"><Icon name="trash" size={14} /></button>}
            </div>
            <div className="small pre"><RichText text={c.body} /></div>
          </div>
        </div>
      ))}
    </div>
  );
}

const KIND_CHIP: Record<string, [string, string]> = {
  promotion: ['chip-accent', 'Promotion'], offer: ['chip-accent', 'Offer'], event: ['chip-info', 'Event'], hiring: ['chip-success', 'Hiring'],
  product: ['chip-brand', 'Product'], service: ['chip-brand', 'Service'], news: ['chip-info', 'News'], announcement: ['chip-accent', 'Announcement'],
};

export function PostCard({ post: initial, onRemoved, showReason = false, expandComments = false, split = false }: { post: Json; onRemoved?: () => void; showReason?: boolean; expandComments?: boolean; split?: boolean }) {
  const { me, can, staffCan } = useSession();
  const act = useAction();
  const toast = useToast();
  const [p, setP] = useState(initial);
  const [showComments, setShowComments] = useState(expandComments);
  const [added, setAdded] = useState<Json[]>([]);
  const [comment, setComment] = useState('');
  const [captionOpen, setCaptionOpen] = useState(split);
  const [burst, setBurst] = useState(0);
  const [pop, setPop] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reposting, setReposting] = useState(false);
  const [repostText, setRepostText] = useState('');

  if (p.removed) return null;
  const pureRepost = !!p.repost && !p.body;
  const c = pureRepost ? p.repost : p;
  if (c.removed) return <article className="card ig-post"><div className="muted small">This post is no longer available.</div></article>;

  const like = async () => {
    const liked = !p.liked;
    setP({ ...p, liked, like_count: p.like_count + (liked ? 1 : -1) });
    if (liked) { setPop(true); setTimeout(() => setPop(false), 500); }
    const r = await act(() => (liked ? post(`/posts/${p.id}/like`) : del(`/posts/${p.id}/like`)));
    if (r) setP((x: Json) => ({ ...x, like_count: r.like_count }));
    else setP((x: Json) => ({ ...x, liked: !liked, like_count: x.like_count + (liked ? -1 : 1) }));
  };
  const doubleTap = () => {
    if (!can('interact')) return;
    setBurst(Date.now());
    if (!p.liked) like();
  };
  const save = async () => {
    const saved = !p.saved;
    setP({ ...p, saved });
    await act(() => (saved ? post('/saves', { target_type: 'post', target_id: p.id }) : del('/saves', { target_type: 'post', target_id: p.id })), saved ? 'Saved' : undefined);
  };
  const share = async () => {
    const url = `${location.origin}/posts/${p.id}`;
    post(`/posts/${p.id}/share`).catch(() => {});
    if (navigator.share) navigator.share({ url, title: 'OmniBiz' }).catch(() => {});
    else {
      await navigator.clipboard?.writeText(url);
      toast('Link copied', 'success');
    }
  };
  const repost = async () => {
    const r = await act(() => post(`/posts/${c.id}/repost`, { body: repostText }), 'Reposted to your followers');
    if (r) {
      setReposting(false);
      setRepostText('');
      setP((x: Json) => ({ ...x, share_count: x.share_count + 1 }));
    }
  };
  const remove = async () => {
    if (!confirm('Delete this post?')) return;
    if (await act(() => del(`/posts/${p.id}`), 'Post deleted')) {
      setP({ ...p, removed: true });
      onRemoved?.();
    }
  };
  const sendComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!comment.trim()) return;
    const r = await act(() => post(`/posts/${p.id}/comments`, { body: comment }));
    if (r) {
      setAdded((a) => [...a, r.comment]);
      setP((x: Json) => ({ ...x, comment_count: x.comment_count + 1 }));
      setShowComments(true);
      setComment('');
    }
  };

  const chip = KIND_CHIP[c.kind];
  const caption = !pureRepost && p.repost ? p.body : c.body;
  const long = (caption ?? '').length > 140 || (caption ?? '').split('\n').length > 2;

  return (
    <article className={`card ig-post${split ? ' split' : ''}`}>
      {showReason && p.reason && !pureRepost && <div className="ig-label"><Icon name="sparkles" />{p.reason}</div>}
      {pureRepost && <div className="ig-label"><Icon name="repeat" /><Link to={`/u/${p.author?.username}`} style={{ color: 'var(--text-2)' }}>{p.author?.display_name}</Link> reposted</div>}

      <header className="ig-head">
        <Link to={`/u/${c.author?.username}`}><Avatar user={c.author} size={40} /></Link>
        <div className="who">
          <div className="row" style={{ gap: 5 }}>
            <Link to={`/u/${c.author?.username}`} className="name truncate">{c.author?.display_name}</Link>
            <Verified show={c.author?.verified} />
            <span className="muted xsmall">• <Link to={`/posts/${c.id}`} className="muted">{timeAgo(c.created_at)}</Link></span>
          </div>
          <div className="sub truncate">{c.author?.headline || ACCOUNT_LABEL[c.author?.account_type]}{(c.city ?? c.author?.city) ? ` · ${c.city ?? c.author?.city}` : ''}</div>
        </div>
        {chip && <span className={`chip ${chip[0]}`}>{chip[1]}</span>}
        <Dropdown trigger={() => <button className="icon-btn" aria-label="Post options"><Icon name="more" /></button>}>
          <button onClick={share}><Icon name="link" />Copy link</button>
          <Link to={`/posts/${c.id}`}><Icon name="eye" />Go to post</Link>
          {(p.mine || staffCan('content')) && <button onClick={remove}><Icon name="trash" />Delete post</button>}
          {!p.mine && <button onClick={() => setReporting(true)}><Icon name="flag" />Report</button>}
        </Dropdown>
      </header>

      <div className="ig-media" onDoubleClick={doubleTap}>
        {!pureRepost && p.repost ? (
          <div style={{ padding: 12, background: 'var(--surface)' }}>
            <div className="row small" style={{ marginBottom: 8 }}><Avatar user={p.repost.author} size={24} /><b>{p.repost.author?.display_name}</b><span className="muted xsmall">· {timeAgo(p.repost.created_at)}</span></div>
            <div style={{ borderRadius: 16, overflow: 'hidden' }}>
              {p.repost.media?.length ? <Carousel media={p.repost.media} /> : <Artwork variant="wide" {...postArt(p.repost)} />}
            </div>
          </div>
        ) : c.media?.length ? <Carousel media={c.media} /> : <Artwork variant="post" {...postArt(c)} />}
        {burst > 0 && <div key={burst} className="heart-burst"><Icon name="heart" fill /></div>}
      </div>

      <div className="ig-body">
        <div className="ig-actions">
          {can('interact') && <button className={`icon-btn${p.liked ? ' on' : ''}${pop ? ' pop' : ''}`} onClick={like} aria-pressed={p.liked} aria-label="Like"><Icon name="heart" fill={p.liked} /></button>}
          <button className="icon-btn" onClick={() => setShowComments((s) => !s)} aria-label="Comments"><Icon name="comment" /></button>
          {can('interact') && <button className="icon-btn" onClick={() => setReposting(true)} aria-label="Repost"><Icon name="repeat" /></button>}
          <button className="icon-btn" onClick={share} aria-label="Share"><Icon name="send" /></button>
          <span className="grow" />
          {can('save') && <button className={`icon-btn${p.saved ? ' on' : ''}`} onClick={save} aria-label="Save" aria-pressed={p.saved}><Icon name="bookmark" fill={p.saved} /></button>}
        </div>
        <div className="ig-likes">{p.like_count > 0 ? `${p.like_count.toLocaleString()} like${p.like_count === 1 ? '' : 's'}` : <span className="muted" style={{ fontWeight: 600 }}>Be the first to like this</span>}</div>
        {caption && (
          <div className={`ig-caption${long && !captionOpen ? ' clamped' : ''}`}>
            <b>{(pureRepost ? c : p).author?.username}</b><RichText text={caption} />
          </div>
        )}
        {long && !captionOpen && <button className="text-btn" style={{ color: 'var(--muted)', alignSelf: 'flex-start', fontWeight: 600 }} onClick={() => setCaptionOpen(true)}>more</button>}
        {c.data?.event_date && <div className="ig-pill"><Icon name="calendar" />{dateLabel(c.data.event_date)}{c.data.event_date.length > 10 ? ` · ${c.data.event_date.slice(11, 16)}` : ''}{c.data.event_location ? ` · ${c.data.event_location}` : ''}</div>}
        {c.data?.product_id && <Link to={`/marketplace/${c.data.product_id}?src=feed`} className="ig-pill"><Icon name="bag" /><span className="grow">View product</span><Icon name="chevronRight" /></Link>}
        {c.data?.job_id && <Link to={`/jobs/${c.data.job_id}?src=feed`} className="ig-pill"><Icon name="briefcase" /><span className="grow">View vacancy & apply</span><Icon name="chevronRight" /></Link>}
        {p.comment_count > 0 && !showComments && <button className="text-btn" style={{ color: 'var(--muted)', alignSelf: 'flex-start', fontWeight: 600 }} onClick={() => setShowComments(true)}>View {p.comment_count === 1 ? '1 comment' : `all ${p.comment_count} comments`}</button>}
        {showComments && <CommentsList postId={p.id} added={added} onCount={(d) => setP((x: Json) => ({ ...x, comment_count: x.comment_count + d }))} />}
        <div className="ig-time">{timeAgo(c.created_at)}{p.share_count > 0 ? ` · ${p.share_count} share${p.share_count === 1 ? '' : 's'}` : ''}</div>
        {can('interact') && (
          <form className="ig-add" onSubmit={sendComment}>
            <Avatar user={me?.user} size={26} />
            <input placeholder="Add a comment…" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={2000} aria-label="Add a comment" />
            {comment.trim() && <button className="text-btn">Post</button>}
          </form>
        )}
      </div>

      {reporting && <ReportDialog targetType="post" targetId={p.id} onClose={() => setReporting(false)} />}
      {reposting && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setReposting(false)}>
          <div className="modal">
            <div className="modal-head"><h3>Repost</h3><button className="icon-btn" onClick={() => setReposting(false)} aria-label="Close"><Icon name="x" /></button></div>
            <div className="modal-body stack">
              {can('create_posts') && <textarea className="textarea" placeholder="Add your thoughts (optional)" value={repostText} onChange={(e) => setRepostText(e.target.value)} maxLength={2000} />}
              <div style={{ borderRadius: 18, overflow: 'hidden' }}><Artwork variant="wide" {...postArt(c)} /></div>
            </div>
            <div className="modal-foot"><button className="btn btn-ghost" onClick={() => setReposting(false)}>Cancel</button><button className="btn btn-primary" onClick={repost}>Repost</button></div>
          </div>
        </div>
      )}
    </article>
  );
}
