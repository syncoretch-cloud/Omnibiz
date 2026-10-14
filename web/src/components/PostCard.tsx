import { Fragment, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Icon } from './Icon.tsx';
import { artBackground, postArt } from './Artwork.tsx';
import { Avatar, Dropdown, Portal, Verified } from './ui.tsx';
import { ReportDialog } from './Report.tsx';
import { del, get, post } from '../lib/api.ts';
import type { Json } from '../lib/api.ts';
import { useAction, useSession, useToast } from '../lib/session.tsx';
import { ACCOUNT_LABEL, compact, dateLabel, timeAgo } from '../lib/format.ts';
import { toggleMusic, usePlaying } from '../lib/music.ts';

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

export function Carousel({ media, alt = [] }: { media: string[]; alt?: string[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [i, setI] = useState(0);
  const go = (d: number) => ref.current?.scrollTo({ left: (i + d) * ref.current.clientWidth, behavior: 'smooth' });
  return (
    <>
      <div className="carousel" ref={ref} onScroll={(e) => setI(Math.round(e.currentTarget.scrollLeft / e.currentTarget.clientWidth))}>
        {media.map((m, k) => (/\.(mp4|webm)$/i.test(m) ? <video key={m} src={m} controls preload="metadata" /> : <img key={m} src={m} alt={alt[k] ?? ''} loading="lazy" draggable={false} />))}
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

/** The post's soundtrack: tap to play or pause (only one sound plays at a time). */
function MusicSticker({ id, music }: { id: number; music: Json }) {
  const key = `post-${id}`;
  const playing = usePlaying(key);
  return (
    <button className={`post-music${playing ? ' on' : ''}`} onClick={() => toggleMusic(key, { track: music.track, url: music.url, start: music.start })} aria-pressed={playing} aria-label={`${playing ? 'Pause' : 'Play'} ${music.title}`}>
      <span className={`eq${playing ? ' on' : ''}`} aria-hidden="true"><i /><i /><i /></span>
      <span className="truncate"><b>{music.title}</b>{music.artist ? ` · ${music.artist}` : ''}</span>
    </button>
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
  if (c.removed) return <article className="card post"><div className="muted small">This post is no longer available.</div></article>;

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
  const caption: string = (!pureRepost && p.repost ? p.body : c.body) ?? '';
  const quoted = !pureRepost && p.repost ? p.repost : null;
  const media: string[] = quoted ? [] : c.media ?? [];
  const long = caption.length > 240 || caption.split('\n').length > 4;
  // Updates without photos read as editorial cards: a kicker, then the words set large.
  const feature = !media.length && !quoted;
  const art = postArt(c);
  const priceChange = c.kind === 'announcement' ? art.price : undefined;
  const heart = burst > 0 && <div key={burst} className="heart-burst"><Icon name="heart" fill /></div>;
  // The frame the author chose when cropping (videos are shown in it too); the author can still comment when comments are off.
  const frame = typeof c.data?.aspect === 'string' && c.data.aspect !== 'original' ? c.data.aspect.replace(':', ' / ') : undefined;
  const commentsOff = !!c.data?.comments_off && !p.mine;

  return (
    <article className={`card post${split && media.length ? ' split' : ''}`}>
      {showReason && p.reason && !pureRepost && <div className="post-context"><Icon name="sparkles" />{p.reason}</div>}
      {pureRepost && <div className="post-context"><Icon name="repeat" /><Link to={`/u/${p.author?.username}`}>{p.author?.display_name}</Link> reposted</div>}

      <header className="post-head">
        <Link to={`/u/${c.author?.username}`}><Avatar user={c.author} size={42} /></Link>
        <div className="who">
          <div className="row" style={{ gap: 5 }}>
            <Link to={`/u/${c.author?.username}`} className="name truncate">{c.author?.display_name}</Link>
            <Verified show={c.author?.verified} />
          </div>
          <div className="sub truncate">
            {c.data?.location
              ? <><Icon name="mapPin" size={12} /> {c.data.location}</>
              : <>{c.author?.headline || ACCOUNT_LABEL[c.author?.account_type]}{(c.city ?? c.author?.city) ? ` · ${c.city ?? c.author?.city}` : ''}</>}
            {' · '}<Link to={`/posts/${c.id}`}>{timeAgo(c.created_at)}</Link>
          </div>
        </div>
        {chip && !feature && <span className={`chip ${chip[0]}`}>{chip[1]}</span>}
        <Dropdown trigger={() => <button className="icon-btn" aria-label="Post options"><Icon name="more" /></button>}>
          <button onClick={share}><Icon name="link" />Copy link</button>
          <Link to={`/posts/${c.id}`}><Icon name="eye" />Go to post</Link>
          {(p.mine || staffCan('content')) && <button onClick={remove}><Icon name="trash" />Delete post</button>}
          {!p.mine && <button onClick={() => setReporting(true)}><Icon name="flag" />Report</button>}
        </Dropdown>
      </header>

      {feature ? (
        <div className="post-feature" onDoubleClick={doubleTap} style={{ ['--feature-art' as string]: artBackground(art.seed) }}>
          <span className="post-kicker">{art.kicker}</span>
          {caption && <div className={`post-feature-text${caption.length <= 180 ? ' lg' : ''}${long && !captionOpen ? ' clamped' : ''}`}><RichText text={caption} /></div>}
          {priceChange && <div className="price-change"><Icon name="tag" />{priceChange}</div>}
          {heart}
        </div>
      ) : (
        <>
          {caption && <div className={`post-text${long && !captionOpen ? ' clamped' : ''}`}><RichText text={caption} /></div>}
          {media.length > 0 && (
            <div className={`post-media${frame ? ' framed' : ''}`} style={frame ? { aspectRatio: frame } : undefined} onDoubleClick={doubleTap}>
              <Carousel media={media} alt={c.data?.alt} />{heart}
            </div>
          )}
          {quoted && (
            <Link to={`/posts/${quoted.id}`} className="post-quoted">
              <div className="row small"><Avatar user={quoted.author} size={24} /><b>{quoted.author?.display_name}</b><span className="muted xsmall">· {timeAgo(quoted.created_at)}</span></div>
              {quoted.body && <div className="small clamp-3">{quoted.body}</div>}
              {quoted.media?.[0] && !/\.(mp4|webm)$/i.test(quoted.media[0]) && <img src={quoted.media[0]} alt="" loading="lazy" />}
            </Link>
          )}
        </>
      )}
      {long && !captionOpen && <button className="text-btn post-more" onClick={() => setCaptionOpen(true)}>Read more</button>}
      {(c.data?.music || c.tagged?.length > 0) && (
        <div className="post-extras">
          {c.data?.music && <MusicSticker id={c.id} music={c.data.music} />}
          {c.tagged?.length > 0 && (
            <span className="post-tagged"><Icon name="users" />with {c.tagged.map((t: Json, k: number) => <Fragment key={t.id}>{k > 0 && ', '}<Link to={`/u/${t.username}`}>{t.display_name}</Link></Fragment>)}</span>
          )}
        </div>
      )}

      {(c.data?.event_date || c.data?.product_id || c.data?.job_id) && (
        <div className="post-links">
          {c.data?.event_date && <span className="post-link"><Icon name="calendar" />{dateLabel(c.data.event_date)}{c.data.event_date.length > 10 ? ` · ${c.data.event_date.slice(11, 16)}` : ''}{c.data.event_location ? ` · ${c.data.event_location}` : ''}</span>}
          {c.data?.product_id && <Link to={`/marketplace/${c.data.product_id}?src=feed`} className="post-link"><Icon name="bag" /><span className="grow">View product</span><Icon name="chevronRight" /></Link>}
          {c.data?.job_id && <Link to={`/jobs/${c.data.job_id}?src=feed`} className="post-link"><Icon name="briefcase" /><span className="grow">View vacancy & apply</span><Icon name="chevronRight" /></Link>}
        </div>
      )}

      <footer className="post-actions">
        {can('interact')
          ? <button className={`act${p.liked ? ' on' : ''}${pop ? ' pop' : ''}`} onClick={like} aria-pressed={p.liked} aria-label="Like"><Icon name="heart" fill={p.liked} /><span>{p.like_count > 0 ? compact(p.like_count) : 'Like'}</span></button>
          : p.like_count > 0 && <span className="act"><Icon name="heart" /><span>{compact(p.like_count)}</span></span>}
        {(!commentsOff || p.comment_count > 0) && (
          <button className={`act${showComments ? ' open' : ''}`} onClick={() => setShowComments((s) => !s)} aria-expanded={showComments} aria-label="Comments"><Icon name="comment" /><span>{p.comment_count > 0 ? compact(p.comment_count) : 'Comment'}</span></button>
        )}
        {can('interact') && <button className="act" onClick={() => setReposting(true)} aria-label="Repost"><Icon name="repeat" /><span className="act-label">Repost</span></button>}
        <button className="act" onClick={share} aria-label="Share"><Icon name="send" /><span className="act-label">{p.share_count > 0 ? compact(p.share_count) : 'Share'}</span></button>
        <span className="grow" />
        {can('save') && <button className={`act icon${p.saved ? ' on' : ''}`} onClick={save} aria-label="Save" aria-pressed={p.saved}><Icon name="bookmark" fill={p.saved} /></button>}
      </footer>

      {showComments && (
        <div className="post-comments">
          <CommentsList postId={p.id} added={added} onCount={(d) => setP((x: Json) => ({ ...x, comment_count: x.comment_count + d }))} />
          {commentsOff && <div className="xsmall muted">Comments are turned off for this post.</div>}
          {can('interact') && !commentsOff && (
            <form className="post-reply" onSubmit={sendComment}>
              <Avatar user={me?.user} size={30} />
              <input className="input" placeholder="Write a comment…" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={2000} aria-label="Write a comment" />
              <button className="btn btn-primary btn-icon" disabled={!comment.trim()} aria-label="Send comment"><Icon name="send" /></button>
            </form>
          )}
        </div>
      )}

      {reporting && <ReportDialog targetType="post" targetId={p.id} onClose={() => setReporting(false)} />}
      {reposting && (
        <Portal>
          <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setReposting(false)}>
            <div className="modal">
              <div className="modal-head"><h3>Repost</h3><button className="icon-btn" onClick={() => setReposting(false)} aria-label="Close"><Icon name="x" /></button></div>
              <div className="modal-body stack">
                {can('create_posts') && <textarea className="textarea" placeholder="Add your thoughts (optional)" value={repostText} onChange={(e) => setRepostText(e.target.value)} maxLength={2000} />}
                <div className="post-quoted">
                  <div className="row small"><Avatar user={c.author} size={24} /><b>{c.author?.display_name}</b><span className="muted xsmall">· {timeAgo(c.created_at)}</span></div>
                  {c.body && <div className="small clamp-3">{c.body}</div>}
                </div>
              </div>
              <div className="modal-foot"><button className="btn btn-ghost" onClick={() => setReposting(false)}>Cancel</button><button className="btn btn-primary" onClick={repost}>Repost</button></div>
            </div>
          </div>
        </Portal>
      )}
    </article>
  );
}
