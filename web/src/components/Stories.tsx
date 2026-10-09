import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Icon } from './Icon.tsx';
import { Artwork, postArt } from './Artwork.tsx';
import { Avatar, Ring, Verified } from './ui.tsx';
import { del, post } from '../lib/api.ts';
import type { Json } from '../lib/api.ts';
import { useApi } from '../lib/hooks.ts';
import { isBusinessType, useAction, useSession, useToast } from '../lib/session.tsx';
import { timeAgo } from '../lib/format.ts';

const STORY_MS = 6000;

// Seen state is a per-viewer convenience, kept in this browser only.
function seenKey(viewerId: number) {
  return `omnibiz-stories-seen-${viewerId}`;
}
export function useSeenStories(viewerId: number) {
  const [seen, setSeen] = useState<Record<string, number>>(() => {
    try { return JSON.parse(localStorage.getItem(seenKey(viewerId)) ?? '{}'); } catch { return {}; }
  });
  const mark = useCallback((authorId: number, postId: number) => {
    setSeen((s) => {
      if ((s[authorId] ?? 0) >= postId) return s;
      const next = { ...s, [authorId]: postId };
      try { localStorage.setItem(seenKey(viewerId), JSON.stringify(next)); } catch { /* storage unavailable */ }
      return next;
    });
  }, [viewerId]);
  return { seen, mark };
}

export function StoryViewer({ stories, start, onClose, onSeen }: { stories: Json[]; start: number; onClose: () => void; onSeen: (authorId: number, postId: number) => void }) {
  const { me } = useSession();
  const act = useAction();
  const toast = useToast();
  const [si, setSi] = useState(start);
  const [ii, setIi] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reply, setReply] = useState('');
  const [liked, setLiked] = useState<Record<number, boolean>>({});
  const press = useRef(0);
  const story = stories[si];
  const item = story?.items[ii];

  const next = useCallback(() => {
    if (!story) return;
    if (ii < story.items.length - 1) setIi(ii + 1);
    else if (si < stories.length - 1) { setSi(si + 1); setIi(0); }
    else onClose();
  }, [ii, si, story, stories.length, onClose]);
  const prev = useCallback(() => {
    if (ii > 0) setIi(ii - 1);
    else if (si > 0) { setSi(si - 1); setIi(0); }
  }, [ii, si]);

  useEffect(() => {
    if (story && item) onSeen(story.user.id, item.id);
  }, [story, item, onSeen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.key === 'ArrowRight') next();
      if (e.key === 'ArrowLeft') prev();
      if (e.key === 'Escape') onClose();
      if (e.key === ' ') { e.preventDefault(); setPaused((p) => !p); }
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prevOverflow; };
  }, [next, prev, onClose]);

  if (!story || !item) return null;
  const isLiked = liked[item.id] ?? item.liked;
  const media = item.media?.[0];

  const sendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reply.trim()) return;
    const r = await act(() => post('/messages/start', { user_id: story.user.id, body: `Replied to your story: ${reply.trim()}` }));
    if (r) { toast('Reply sent', 'success'); setReply(''); setPaused(false); }
  };
  const like = async () => {
    setLiked((l) => ({ ...l, [item.id]: !isLiked }));
    await act(() => (isLiked ? del(`/posts/${item.id}/like`) : post(`/posts/${item.id}/like`)));
  };

  // Tap left/right to navigate; press and hold to pause.
  const zone = (dir: 'left' | 'right') => ({
    onPointerDown: () => { press.current = Date.now(); setPaused(true); },
    onPointerUp: () => { setPaused(false); if (Date.now() - press.current < 220) (dir === 'left' ? prev : next)(); },
    onPointerLeave: () => setPaused(false),
  });

  return (
    <div className="story-viewer" onMouseDown={(e) => e.target === e.currentTarget && onClose()} role="dialog" aria-label={`Story from ${story.user.display_name}`}>
      <button className="btn btn-glass btn-icon story-close" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
      <div style={{ position: 'relative' }}>
        {si > 0 && <button className="btn btn-glass btn-icon story-nav" style={{ left: -64 }} onClick={() => { setSi(si - 1); setIi(0); }} aria-label="Previous story"><Icon name="chevronLeft" /></button>}
        {si < stories.length - 1 && <button className="btn btn-glass btn-icon story-nav" style={{ right: -64 }} onClick={() => { setSi(si + 1); setIi(0); }} aria-label="Next story"><Icon name="chevronRight" /></button>}
        <div className="story-frame" key={si}>
          {media ? (/\.(mp4|webm)$/i.test(media) ? <video src={media} autoPlay muted playsInline /> : <img src={media} alt="" />) : <Artwork variant="story" {...postArt(item)} />}
          <div className="story-top">
            <div className={`story-bars${paused ? ' paused' : ''}`}>
              {story.items.map((it: Json, k: number) => (
                <i key={it.id} className={k < ii ? 'done' : k === ii ? 'now' : ''}>
                  <b key={k === ii ? `${si}-${ii}` : k} style={{ ['--dur' as string]: `${STORY_MS}ms` }} onAnimationEnd={k === ii ? next : undefined} />
                </i>
              ))}
            </div>
            <div className="row">
              <Link to={`/u/${story.user.username}`} onClick={onClose}><Avatar user={story.user} size={34} /></Link>
              <div className="grow small" style={{ lineHeight: 1.2 }}>
                <Link to={`/u/${story.user.username}`} onClick={onClose} className="bold" style={{ color: '#fff6ee' }}>{story.user.display_name}</Link> <Verified show={story.user.verified} />
                <span style={{ opacity: 0.75 }}> · {timeAgo(item.created_at)}</span>
                {story.suggested && <div className="xsmall" style={{ opacity: 0.75 }}>Suggested for you</div>}
              </div>
              <button className="icon-btn" style={{ color: '#fff6ee' }} onClick={() => setPaused((p) => !p)} aria-label={paused ? 'Play' : 'Pause'}><Icon name={paused ? 'play' : 'pause'} /></button>
            </div>
          </div>
          <div className="story-zone left" {...zone('left')} />
          <div className="story-zone right" {...zone('right')} />
          {media && item.body && <div className="story-caption clamp-3">{item.body}</div>}
          {(item.data?.product_id || item.data?.job_id) && (
            <Link to={item.data.product_id ? `/marketplace/${item.data.product_id}?src=story` : `/jobs/${item.data.job_id}?src=story`} onClick={onClose} className="btn btn-glass" style={{ position: 'absolute', zIndex: 6, left: '50%', transform: 'translateX(-50%)', bottom: 78 }}>
              <Icon name={item.data.product_id ? 'bag' : 'briefcase'} />{item.data.product_id ? 'View product' : 'View vacancy'}
            </Link>
          )}
          <form className="story-bottom" onSubmit={sendReply}>
            {story.user.id !== me?.user.id ? (
              <>
                <input placeholder={`Reply to ${story.user.display_name}…`} value={reply} onChange={(e) => setReply(e.target.value)} onFocus={() => setPaused(true)} onBlur={() => !reply && setPaused(false)} maxLength={1000} />
                <button type="button" className={`btn btn-icon ${isLiked ? 'btn-primary' : 'btn-glass'}`} onClick={like} aria-label="Like"><Icon name="heart" fill={isLiked} /></button>
                <button className="btn btn-glass btn-icon" aria-label="Send" disabled={!reply.trim()}><Icon name="send" /></button>
              </>
            ) : <Link to={`/posts/${item.id}`} onClick={onClose} className="btn btn-glass btn-sm"><Icon name="eye" />{item.like_count} likes · {item.comment_count} comments</Link>}
          </form>
        </div>
      </div>
    </div>
  );
}

export function StoriesBar({ onCreate }: { onCreate?: () => void }) {
  const { me, can } = useSession();
  const { data } = useApi('/reels/stories');
  const { seen, mark } = useSeenStories(me!.user.id);
  // Freeze the order while viewing: marking stories as seen re-sorts the bar.
  const [viewing, setViewing] = useState<{ list: Json[]; start: number } | null>(null);
  const stories: Json[] = data?.stories ?? [];
  const hasMine = stories.some((s) => s.user.id === me!.user.id);
  const isSeen = (s: Json) => (seen[s.user.id] ?? 0) >= s.latest_id;
  // Unseen first (keeping the viewer's own story at the front), like Instagram.
  const ordered = [...stories].sort((a, b) => (a.user.id === me!.user.id ? -1 : b.user.id === me!.user.id ? 1 : Number(isSeen(a)) - Number(isSeen(b))));

  return (
    <>
      <div className="stories" aria-label="Stories">
        {!hasMine && can('create_posts') && (
          <button className="story-btn" onClick={onCreate}>
            <span style={{ position: 'relative' }}>
              <Ring seen square={isBusinessType(me!.user.account_type)}><Avatar user={me!.user} size={64} /></Ring>
              <span className="plus"><Icon name="plus" /></span>
            </span>
            <span>Your story</span>
          </button>
        )}
        {ordered.map((s) => (
          <button key={s.user.id} className="story-btn" onClick={() => setViewing({ list: ordered, start: ordered.indexOf(s) })} title={s.user.display_name}>
            <Ring seen={isSeen(s)} square={isBusinessType(s.user.account_type)}><Avatar user={s.user} size={64} /></Ring>
            <span>{s.user.id === me!.user.id ? 'Your story' : s.user.username}</span>
          </button>
        ))}
        {!data && Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="story-btn"><span className="skeleton" style={{ width: 74, height: 74, borderRadius: '50%' }} /><span className="skeleton" style={{ width: 54, height: 10 }} /></div>
        ))}
      </div>
      {viewing && <StoryViewer stories={viewing.list} start={viewing.start} onClose={() => setViewing(null)} onSeen={mark} />}
    </>
  );
}
