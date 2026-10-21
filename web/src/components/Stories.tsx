import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Icon } from './Icon.tsx';
import { artBackground } from './Artwork.tsx';
import { Avatar, Portal, Spinner, Verified } from './ui.tsx';
import { STORY_EVENT, StoryCreator } from './StoryCreator.tsx';
import { del, get, post } from '../lib/api.ts';
import type { Json } from '../lib/api.ts';
import { useApi } from '../lib/hooks.ts';
import { isBusinessType, useAction, useSession, useToast } from '../lib/session.tsx';
import { timeAgo } from '../lib/format.ts';
import { playMusic, stopMusic } from '../lib/music.ts';

const STORY_MS = 6000;
const VIDEO_MS = 12000;
const isVideo = (m?: string) => !!m && /\.(mp4|webm)$/i.test(m);

/** Who has seen your story. */
function Viewers({ storyId, onClose }: { storyId: number; onClose: () => void }) {
  const { data, loading } = useApi(`/stories/${storyId}/viewers`);
  return (
    <div className="story-viewers" onPointerDown={(e) => e.stopPropagation()}>
      <div className="row-between"><b>Viewed by {data?.viewers?.length ?? ''}</b><button className="icon-btn" onClick={onClose} aria-label="Close viewers"><Icon name="x" /></button></div>
      {loading ? <Spinner /> : data?.viewers?.length ? data.viewers.map((v: Json) => (
        <Link key={v.id} to={`/u/${v.username}`} className="row story-viewer-row">
          <Avatar user={v} size={34} />
          <span className="grow small bold truncate">{v.display_name}</span>
          <span className="xsmall muted">{timeAgo(v.viewed_at)}</span>
        </Link>
      )) : <p className="small muted">No views yet.</p>}
    </div>
  );
}

/** Full-screen story player: tap left/right to step, hold to pause; your own story shows its viewers. */
export function StoryViewer({ stories, start, onClose }: { stories: Json[]; start: number; onClose: () => void }) {
  const act = useAction();
  const toast = useToast();
  const [si, setSi] = useState(start);
  const [ii, setIi] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reply, setReply] = useState('');
  const [removed, setRemoved] = useState<number[]>([]);
  const [showViewers, setShowViewers] = useState(false);
  const press = useRef(0);
  const story = stories[si];
  const items: Json[] = (story?.items ?? []).filter((x: Json) => !removed.includes(x.id));
  const item = items[ii];

  const next = useCallback(() => {
    setShowViewers(false);
    if (ii < items.length - 1) setIi(ii + 1);
    else if (si < stories.length - 1) { setSi(si + 1); setIi(0); }
    else onClose();
  }, [ii, si, items.length, stories.length, onClose]);
  const prev = useCallback(() => {
    setShowViewers(false);
    if (ii > 0) setIi(ii - 1);
    else if (si > 0) { setSi(si - 1); setIi(0); }
  }, [ii, si]);

  // Seen state lives on the server, so it follows the viewer across devices.
  useEffect(() => {
    if (item && !item.mine && !item.viewed) post(`/stories/${item.id}/view`).catch(() => {});
  }, [item]);
  // A story's music plays while it is on screen.
  useEffect(() => {
    if (!item?.music) return;
    playMusic(`story-${item.id}`, item.music);
    return () => stopMusic();
  }, [item]);
  useEffect(() => {
    if (story && !items.length) next();
  }, [story, items.length, next]);

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
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prevOverflow; stopMusic(); };
  }, [next, prev, onClose]);

  if (!story || !item) return null;
  const mine = !!item.mine;

  const sendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reply.trim()) return;
    const r = await act(() => post('/messages/start', { user_id: story.user.id, body: `Replied to your story: ${reply.trim()}` }));
    if (r) { toast('Reply sent', 'success'); setReply(''); setPaused(false); }
  };
  const react = async () => {
    if (await act(() => post('/messages/start', { user_id: story.user.id, body: '❤️ Reacted to your story' }))) toast('Reaction sent', 'success');
  };
  const remove = async () => {
    if (!confirm('Delete this story?')) return;
    if (await act(() => del(`/stories/${item.id}`), 'Story deleted')) {
      window.dispatchEvent(new Event(STORY_EVENT));
      setRemoved((r) => [...r, item.id]);
      if (ii >= items.length - 1) setIi(Math.max(0, ii - 1));
    }
  };
  // Tap left/right to navigate; press and hold to pause.
  const zone = (dir: 'left' | 'right') => ({
    onPointerDown: () => { press.current = Date.now(); setPaused(true); },
    onPointerUp: () => { setPaused(false); if (Date.now() - press.current < 220) (dir === 'left' ? prev : next)(); },
    onPointerLeave: () => setPaused(false),
  });
  const hold = paused || showViewers;

  return (
    <Portal>
      <div className="story-viewer" onMouseDown={(e) => e.target === e.currentTarget && onClose()} role="dialog" aria-label={`Story from ${story.user.display_name}`}>
        <button className="btn btn-glass btn-icon story-close" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        <div style={{ position: 'relative' }}>
          {si > 0 && <button className="btn btn-glass btn-icon story-nav" style={{ left: -64 }} onClick={() => { setSi(si - 1); setIi(0); }} aria-label="Previous story"><Icon name="chevronLeft" /></button>}
          {si < stories.length - 1 && <button className="btn btn-glass btn-icon story-nav" style={{ right: -64 }} onClick={() => { setSi(si + 1); setIi(0); }} aria-label="Next story"><Icon name="chevronRight" /></button>}
          <div className="story-frame" key={`${si}-${item.id}`}>
            {item.media
              ? (isVideo(item.media) ? <video src={item.media} autoPlay muted={!!item.music} playsInline /> : <img src={item.media} alt="" />)
              : <div className="story-text" style={{ background: artBackground(`story-bg-${item.bg ?? item.id}`) }}><p>{item.body}</p></div>}
            <div className="story-top">
              <div className={`story-bars${hold ? ' paused' : ''}`}>
                {items.map((it, k) => (
                  <i key={it.id} className={k < ii ? 'done' : k === ii ? 'now' : ''}>
                    <b key={k === ii ? `${si}-${it.id}` : k} style={{ ['--dur' as string]: `${isVideo(it.media) ? VIDEO_MS : STORY_MS}ms` }} onAnimationEnd={k === ii ? next : undefined} />
                  </i>
                ))}
              </div>
              <div className="row">
                <Link to={`/u/${story.user.username}`} onClick={onClose}><Avatar user={story.user} size={34} square={isBusinessType(story.user.account_type)} /></Link>
                <div className="grow small" style={{ lineHeight: 1.2 }}>
                  <Link to={`/u/${story.user.username}`} onClick={onClose} className="bold" style={{ color: '#fff6ee' }}>{mine ? 'Your story' : story.user.display_name}</Link> {!mine && <Verified show={story.user.verified} />}
                  <span style={{ opacity: 0.75 }}> · {timeAgo(item.created_at)}</span>
                  {item.music && <div className="xsmall" style={{ opacity: 0.85 }}><Icon name="music" size={11} /> {item.music.title}</div>}
                  {story.suggested && <div className="xsmall" style={{ opacity: 0.75 }}>Suggested for you</div>}
                </div>
                <button className="icon-btn" style={{ color: '#fff6ee' }} onClick={() => setPaused((p) => !p)} aria-label={paused ? 'Play' : 'Pause'}><Icon name={paused ? 'play' : 'pause'} /></button>
              </div>
            </div>
            <div className="story-zone left" {...zone('left')} />
            <div className="story-zone right" {...zone('right')} />
            {item.media && item.body && <div className="story-caption clamp-3">{item.body}</div>}
            <div className="story-bottom">
              {mine ? (
                <>
                  <button className="btn btn-glass btn-sm" onClick={() => setShowViewers(true)}><Icon name="eye" />{item.view_count ?? 0} {item.view_count === 1 ? 'view' : 'views'}</button>
                  <span className="grow" />
                  <button className="btn btn-glass btn-icon btn-sm" onClick={remove} aria-label="Delete story"><Icon name="trash" /></button>
                </>
              ) : (
                <form className="row grow" onSubmit={sendReply} style={{ gap: 8 }}>
                  <input placeholder={`Reply to ${story.user.display_name}…`} value={reply} onChange={(e) => setReply(e.target.value)} onFocus={() => setPaused(true)} onBlur={() => !reply && setPaused(false)} maxLength={1000} />
                  <button type="button" className="btn btn-glass btn-icon" onClick={react} aria-label="Send a heart"><Icon name="heart" /></button>
                  <button className="btn btn-glass btn-icon" aria-label="Send" disabled={!reply.trim()}><Icon name="send" /></button>
                </form>
              )}
            </div>
            {showViewers && <Viewers storyId={item.id} onClose={() => setShowViewers(false)} />}
          </div>
        </div>
      </div>
    </Portal>
  );
}

/** The cover of a story card: its latest photo, video frame or text card. */
function Cover({ item }: { item: Json }) {
  if (item.media) return isVideo(item.media) ? <video src={item.media} muted preload="metadata" /> : <img src={item.media} alt="" loading="lazy" />;
  return <span className="pulse-text" style={{ background: artBackground(`story-bg-${item.bg ?? item.id}`) }}><span>{item.body}</span></span>;
}

/** The stories strip: your story first, then people you follow (unseen first), then suggested accounts. */
export function StoriesBar() {
  const { me, can } = useSession();
  const { data, reload } = useApi('/stories');
  const [viewing, setViewing] = useState<{ list: Json[]; start: number } | null>(null);
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    window.addEventListener(STORY_EVENT, reload);
    return () => window.removeEventListener(STORY_EVENT, reload);
  }, [reload]);
  const stories: Json[] = data?.stories ?? [];
  const mine = stories.find((s) => s.user.id === me!.user.id);
  const others = stories.filter((s) => s !== mine);
  const latest = (s: Json) => s.items[s.items.length - 1];

  return (
    <>
      <div className="pulse" aria-label="Stories">
        {can('create_posts') && (mine ? (
          <div className="pulse-mine">
            <button className="pulse-card" onClick={() => setViewing({ list: [mine], start: 0 })} title="Your story">
              <Cover item={latest(mine)} />
              <span className="pulse-who">
                <Avatar user={me!.user} size={30} square={isBusinessType(me!.user.account_type)} />
                <span className="pulse-name">Your story</span>
                <span className="pulse-meta">{mine.items.length} · {timeAgo(latest(mine).created_at)}</span>
              </span>
            </button>
            <button className="pulse-add" onClick={() => setCreating(true)} aria-label="Add to your story"><Icon name="plus" /></button>
          </div>
        ) : (
          <button className="pulse-card pulse-new" onClick={() => setCreating(true)}>
            <span className="plus-orb"><Icon name="plus" /></span>
            Add to your story
          </button>
        ))}
        {others.map((s, i) => (
          <button key={s.user.id} className={`pulse-card${s.all_seen ? '' : ' unseen'}`} onClick={() => setViewing({ list: others, start: i })} title={s.user.display_name}>
            <Cover item={latest(s)} />
            <span className="pulse-who">
              <Avatar user={s.user} size={30} square={isBusinessType(s.user.account_type)} />
              <span className="pulse-name">{s.user.display_name}</span>
              <span className="pulse-meta">{s.suggested ? 'Suggested · ' : ''}{timeAgo(latest(s).created_at)}</span>
            </span>
          </button>
        ))}
        {!data && Array.from({ length: 5 }, (_, i) => <span key={i} className="pulse-card skeleton" />)}
        {data && !others.length && <p className="pulse-empty small muted">No stories from others yet. When people you follow add one, it shows here for 24 hours.</p>}
      </div>
      {viewing && <StoryViewer stories={viewing.list} start={viewing.start} onClose={() => { setViewing(null); reload(); }} />}
      {creating && <StoryCreator onClose={() => setCreating(false)} />}
    </>
  );
}
