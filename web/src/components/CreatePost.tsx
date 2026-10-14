import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { Icon } from './Icon.tsx';
import { Avatar, ErrorBox, Portal } from './ui.tsx';
import { artBackground } from './Artwork.tsx';
import { get, post, uploadMedia } from '../lib/api.ts';
import type { Json } from '../lib/api.ts';
import { isBusinessType, useSession, useToast } from '../lib/session.tsx';
import { label } from '../lib/format.ts';
import { useDebounced } from '../lib/hooks.ts';
import { ADJUSTMENTS, ASPECTS, FILTERS, NEW_EDIT, NO_ADJUST, cropRect, exportEdit, loadImage, ratioOf, renderEdit } from '../lib/imageEdit.ts';
import type { Adjust, Aspect, Edit } from '../lib/imageEdit.ts';
import { STYLE_NAMES, TRACKS, playMusic, stopMusic, toggleMusic, usePlaying } from '../lib/music.ts';

export const POSTED_EVENT = 'omnibiz:posted';

type Step = 'select' | 'crop' | 'edit' | 'details';
interface Item { key: string; file: File; url: string; video: boolean; img?: HTMLImageElement; edit: Edit; alt: string }
interface Music { track?: string; file?: File; url?: string; title: string; artist: string; start: number; duration?: number }

const MAX_ITEMS = 10;
const MAX_CAPTION = 2200;
const PHOTO = /^image\/(jpeg|png|webp)$/;
const VIDEO = /^video\/(mp4|webm)$/;
const AUDIO = /^audio\/(mpeg|mp4|x-m4a|aac|ogg|wav|x-wav)$/;
const EMOJI = ['😀', '😂', '😍', '🥰', '😎', '🤩', '🔥', '👏', '🙌', '💯', '🎉', '❤️', '🧡', '🙏', '😮', '😢', '✨', '🌍', '🇹🇿', '💼', '🛍️', '📦', '🚚', '☀️', '🌿', '☕', '🎶', '📍', '✅', '💪'];

/** Measures an element's content box. */
function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

/** The frame a photo is shown in at the chosen ratio, sized to fit the stage. */
function frameSize(stage: { w: number; h: number }, ratio: number) {
  const w = Math.min(stage.w, stage.h * ratio);
  return { w, h: w / ratio };
}

// ───────────── crop: drag to reposition, zoom, thirds grid ─────────────
function CropFrame({ item, aspect, onEdit }: { item: Item; aspect: Aspect; onEdit: (e: Partial<Edit>) => void }) {
  const [stageRef, stage] = useSize<HTMLDivElement>();
  const [drag, setDrag] = useState<{ x: number; y: number; ex: number; ey: number } | null>(null);
  const img = item.img;
  const ratio = img ? ratioOf(aspect, img.naturalWidth, img.naturalHeight) : aspect === 'original' ? 4 / 5 : ratioOf(aspect, 1, 1);
  const frame = frameSize(stage, ratio);
  let imgStyle: React.CSSProperties = {};
  let k = 1;
  let rect = { sx: 0, sy: 0, sw: 1, sh: 1 };
  if (img && frame.w) {
    rect = cropRect(img.naturalWidth, img.naturalHeight, aspect, item.edit);
    k = frame.w / rect.sw;
    imgStyle = { width: img.naturalWidth * k, height: img.naturalHeight * k, transform: `translate(${-rect.sx * k}px, ${-rect.sy * k}px)` };
  }
  const move = (e: React.PointerEvent) => {
    if (!drag || !img) return;
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const spareX = (w - rect.sw) / 2;
    const spareY = (h - rect.sh) / 2;
    const cx0 = w / 2 + drag.ex * spareX - (e.clientX - drag.x) / k;
    const cy0 = h / 2 + drag.ey * spareY - (e.clientY - drag.y) / k;
    onEdit({
      x: spareX > 0.5 ? Math.max(-1, Math.min(1, (cx0 - w / 2) / spareX)) : 0,
      y: spareY > 0.5 ? Math.max(-1, Math.min(1, (cy0 - h / 2) / spareY)) : 0,
    });
  };
  return (
    <div className="cp-stage-inner" ref={stageRef}>
      <div
        className={`cp-frame${drag ? ' dragging' : ''}`}
        style={{ width: frame.w, height: frame.h }}
        onPointerDown={(e) => { if (!img) return; e.currentTarget.setPointerCapture(e.pointerId); setDrag({ x: e.clientX, y: e.clientY, ex: item.edit.x, ey: item.edit.y }); }}
        onPointerMove={move}
        onPointerUp={() => setDrag(null)}
        onPointerCancel={() => setDrag(null)}
      >
        {item.video ? <video src={item.url} muted autoPlay loop playsInline /> : <img src={item.url} alt="" draggable={false} style={imgStyle} />}
        {!item.video && <div className="cp-grid" aria-hidden="true"><i /><i /><i /><i /></div>}
      </div>
    </div>
  );
}

// ───────────── edit: live preview canvas ─────────────
function EditPreview({ item, aspect }: { item: Item; aspect: Aspect }) {
  const [stageRef, stage] = useSize<HTMLDivElement>();
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!item.img || !canvas.current) return;
    const id = requestAnimationFrame(() => renderEdit(item.img!, aspect, item.edit, 820, canvas.current!));
    return () => cancelAnimationFrame(id);
  }, [item.img, item.edit, aspect]);
  const ratio = item.img ? ratioOf(aspect, item.img.naturalWidth, item.img.naturalHeight) : 4 / 5;
  const frame = frameSize(stage, ratio);
  return (
    <div className="cp-stage-inner" ref={stageRef}>
      <div className="cp-frame" style={{ width: frame.w, height: frame.h }}>
        {item.video ? <video src={item.url} muted autoPlay loop playsInline /> : <canvas ref={canvas} />}
      </div>
    </div>
  );
}

function FilterGrid({ item, aspect, onPick }: { item: Item; aspect: Aspect; onPick: (id: string) => void }) {
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const { zoom, x, y } = item.edit;
  useEffect(() => {
    if (!item.img) return;
    let cancelled = false;
    const id = requestAnimationFrame(() => {
      const out: Record<string, string> = {};
      for (const f of FILTERS) out[f.id] = renderEdit(item.img!, aspect, { zoom, x, y, filter: f.id, adjust: NO_ADJUST }, 150).toDataURL('image/jpeg', 0.8);
      if (!cancelled) setThumbs(out);
    });
    return () => { cancelled = true; cancelAnimationFrame(id); };
  }, [item.img, aspect, zoom, x, y]);
  return (
    <div className="cp-filters">
      {FILTERS.map((f) => (
        <button key={f.id} className={`cp-filter${item.edit.filter === f.id ? ' on' : ''}`} onClick={() => onPick(f.id)}>
          <span className="cp-filter-thumb">{thumbs[f.id] ? <img src={thumbs[f.id]} alt="" /> : <span className="skeleton" />}</span>
          {f.name}
        </button>
      ))}
    </div>
  );
}

function Adjustments({ value, onChange }: { value: Adjust; onChange: (a: Adjust) => void }) {
  return (
    <div className="cp-adjust">
      {ADJUSTMENTS.map(({ key, label: name, min }) => (
        <label key={key} className="cp-slider">
          <span className="row-between">
            <span className="bold small">{name}</span>
            {value[key] !== 0 ? <button type="button" className="text-btn" onClick={() => onChange({ ...value, [key]: 0 })}>Reset · {value[key] > 0 ? `+${value[key]}` : value[key]}</button> : <span className="xsmall muted">0</span>}
          </span>
          <input type="range" min={min} max={100} value={value[key]} onChange={(e) => onChange({ ...value, [key]: Number(e.target.value) })} />
        </label>
      ))}
    </div>
  );
}

// ───────────── details: music, tags, toggles ─────────────
function EqBars({ on }: { on: boolean }) {
  return <span className={`eq${on ? ' on' : ''}`} aria-hidden="true"><i /><i /><i /></span>;
}

function TrackRow({ id, title, sub, chosen, onUse }: { id: string; title: string; sub: string; chosen: boolean; onUse: () => void }) {
  const key = `pick-${id}`;
  const playing = usePlaying(key);
  return (
    <div className={`cp-track${chosen ? ' on' : ''}`}>
      <button type="button" className="cp-track-art" style={{ background: artBackground(`track-${id}`) }} onClick={() => toggleMusic(key, { track: id })} aria-label={playing ? `Pause ${title}` : `Preview ${title}`}>
        {playing ? <EqBars on /> : <Icon name="play" />}
      </button>
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="bold small truncate">{title}</div>
        <div className="xsmall muted truncate">{sub}</div>
      </div>
      <button type="button" className={`btn btn-sm ${chosen ? 'btn-primary' : 'btn-outline'}`} onClick={onUse}>{chosen ? <Icon name="check" /> : 'Use'}</button>
    </div>
  );
}

function MusicPanel({ value, onChange, onDone }: { value: Music | null; onChange: (m: Music | null) => void; onDone: () => void }) {
  const { me } = useSession();
  const [q, setQ] = useState('');
  const [mood, setMood] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const previewing = usePlaying('pick-own');
  const moods = [...new Set(TRACKS.map((t) => t.mood))];
  const list = TRACKS.filter((t) => (!mood || t.mood === mood) && (!q || `${t.title} ${t.mood} ${t.style}`.toLowerCase().includes(q.toLowerCase())));
  const pickFile = (f?: File) => {
    if (!f) return;
    if (!AUDIO.test(f.type)) { setError('Choose an MP3, M4A, AAC, OGG or WAV file.'); return; }
    setError(null);
    const url = URL.createObjectURL(f);
    const a = new Audio(url);
    a.onloadedmetadata = () => onChange({ file: f, url, title: f.name.replace(/\.[^.]+$/, '').slice(0, 80), artist: me?.user.display_name ?? '', start: 0, duration: a.duration });
    a.onerror = () => { setError('That audio file could not be read.'); URL.revokeObjectURL(url); };
  };
  return (
    <div className="cp-panel">
      <div className="cp-panel-head">
        <button type="button" className="icon-btn" onClick={() => { stopMusic(); onDone(); }} aria-label="Back to details"><Icon name="arrowLeft" /></button>
        <b>Add music</b>
        <button type="button" className="text-btn" onClick={() => { stopMusic(); onDone(); }}>Done</button>
      </div>
      <div className="input-icon"><Icon name="search" /><input className="input search-input" placeholder="Search music" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <div className="filter-bar">
        <button type="button" className={`chip${!mood ? ' active' : ''}`} onClick={() => setMood('')}>For you</button>
        {moods.map((m) => <button key={m} type="button" className={`chip${mood === m ? ' active' : ''}`} onClick={() => setMood(m)}>{m}</button>)}
      </div>
      <ErrorBox error={error} />
      <div className="cp-own">
        <button type="button" className="btn btn-outline btn-sm" onClick={() => fileRef.current?.click()}><Icon name="upload" />Use your own sound</button>
        <input ref={fileRef} type="file" accept="audio/mpeg,audio/mp4,audio/x-m4a,audio/aac,audio/ogg,audio/wav" hidden onChange={(e) => pickFile(e.target.files?.[0])} />
      </div>
      {value?.file && (
        <div className="cp-track on">
          <button type="button" className="cp-track-art" style={{ background: 'var(--grad-brand)' }} onClick={() => toggleMusic('pick-own', { url: value.url, start: value.start })} aria-label="Preview your sound">
            {previewing ? <EqBars on /> : <Icon name="play" />}
          </button>
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="bold small truncate">{value.title}</div>
            <div className="xsmall muted">Starts at {Math.floor(value.start / 60)}:{String(value.start % 60).padStart(2, '0')}</div>
            {(value.duration ?? 0) > 16 && (
              <input type="range" min={0} max={Math.floor((value.duration ?? 15) - 15)} value={value.start} aria-label="Start time"
                onChange={(e) => { const start = Number(e.target.value); onChange({ ...value, start }); if (previewing) playMusic('pick-own', { url: value.url, start }); }} />
            )}
          </div>
          <button type="button" className="icon-btn" onClick={() => { stopMusic(); onChange(null); }} aria-label="Remove sound"><Icon name="x" /></button>
        </div>
      )}
      <div className="cp-tracks">
        {list.map((t) => (
          <TrackRow key={t.id} id={t.id} title={t.title} sub={`${t.mood} · ${STYLE_NAMES[t.style]} · ${t.bpm} BPM`} chosen={value?.track === t.id}
            onUse={() => onChange(value?.track === t.id ? null : { track: t.id, title: t.title, artist: t.artist, start: 0 })} />
        ))}
        {!list.length && <p className="muted small center" style={{ padding: 20 }}>No tracks match.</p>}
      </div>
      <p className="xsmall muted">OmniBiz Sounds are original tracks made for OmniBiz and free to use on your posts.</p>
    </div>
  );
}

function TagPeople({ value, onChange }: { value: Json[]; onChange: (v: Json[]) => void }) {
  const { me } = useSession();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Json[]>([]);
  const dq = useDebounced(q, 200);
  useEffect(() => {
    if (dq.trim().length < 2) { setResults([]); return; }
    const ctrl = new AbortController();
    get(`/search/suggest?q=${encodeURIComponent(dq)}`, ctrl.signal)
      .then((r) => setResults(r.suggestions.filter((s: Json) => s.id && s.id !== me?.user.id && !value.some((v) => v.id === s.id))))
      .catch(() => {});
    return () => ctrl.abort();
  }, [dq, value, me?.user.id]);
  return (
    <div className="stack-sm">
      {value.length > 0 && (
        <div className="row-wrap">
          {value.map((u) => <span key={u.id} className="chip chip-brand">@{u.username}<button type="button" className="icon-btn" style={{ padding: 0 }} onClick={() => onChange(value.filter((x) => x.id !== u.id))} aria-label={`Untag ${u.username}`}><Icon name="x" size={12} /></button></span>)}
        </div>
      )}
      {value.length < 20 && <input className="input" placeholder="Search people and businesses" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Tag people" />}
      {results.length > 0 && (
        <div className="suggest-box">
          {results.slice(0, 5).map((s) => (
            <a key={s.id} href="#" onClick={(e) => { e.preventDefault(); onChange([...value, { id: s.id, username: s.username, display_name: s.label }]); setQ(''); }}>
              <Avatar user={{ display_name: s.label, avatar_url: s.avatar_url, account_type: s.account_type }} size={32} />
              <div className="grow"><div className="small bold truncate">{s.label}</div><div className="xsmall muted">{s.sub}</div></div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function Toggle({ checked, onChange, title, hint }: { checked: boolean; onChange: (v: boolean) => void; title: string; hint: string }) {
  return (
    <label className="cp-toggle">
      <span className="grow"><span className="small bold">{title}</span><span className="xsmall muted">{hint}</span></span>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch" aria-hidden="true" />
    </label>
  );
}

function Section({ icon, title, children, aside, open: initial = false }: { icon: string; title: string; children: ReactNode; aside?: ReactNode; open?: boolean }) {
  const [open, setOpen] = useState(initial);
  return (
    <div className={`cp-section${open ? ' open' : ''}`}>
      <button type="button" className="cp-section-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Icon name={icon} /><span className="grow">{title}</span>{aside}<Icon name="chevronDown" />
      </button>
      {open && <div className="cp-section-body">{children}</div>}
    </div>
  );
}

// ───────────── the dialog ─────────────
/** Instagram-style "Create new post": select → crop → edit → details & share. */
export function CreatePostModal({ onClose }: { onClose: () => void }) {
  const { me, meta } = useSession();
  const toast = useToast();
  const nav = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>('select');
  const [items, setItems] = useState<Item[]>([]);
  const [cur, setCur] = useState(0);
  const [aspect, setAspect] = useState<Aspect>('4:5');
  const [tool, setTool] = useState<'aspect' | 'zoom' | 'gallery' | null>(null);
  const [editTab, setEditTab] = useState<'filters' | 'adjust'>('filters');
  const [textOnly, setTextOnly] = useState(false);
  const [panel, setPanel] = useState<'main' | 'music'>('main');
  const [body, setBody] = useState('');
  const [emoji, setEmoji] = useState(false);
  const [kind, setKind] = useState('text');
  const [eventDate, setEventDate] = useState('');
  const [eventLoc, setEventLoc] = useState('');
  const [location, setLocation] = useState('');
  const [tagged, setTagged] = useState<Json[]>([]);
  const [music, setMusic] = useState<Music | null>(null);
  const [hideLikes, setHideLikes] = useState(false);
  const [commentsOff, setCommentsOff] = useState(false);
  const [finals, setFinals] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  // 'close' discards the whole draft; 'select' (back from Crop) returns to choosing photos.
  const [discard, setDiscard] = useState<'close' | 'select' | null>(null);
  const caption = useRef<HTMLTextAreaElement>(null);
  const urls = useRef<string[]>([]);
  const biz = isBusinessType(me?.user.account_type);
  const kinds = (meta?.post_kinds ?? ['text']).filter((k) => biz || ['text', 'news', 'event', 'update'].includes(k));
  const item = items[Math.min(cur, items.length - 1)];
  const dirty = items.length > 0 || body.trim().length > 0;
  const musicPlaying = usePlaying('creator');

  // Release local previews and stop any sound when the dialog closes.
  useEffect(() => () => { urls.current.forEach((u) => URL.revokeObjectURL(u)); stopMusic(); }, []);
  const close = () => (busy ? undefined : dirty ? setDiscard('close') : onClose());
  const onEscape = useRef(close);
  onEscape.current = () => (discard ? setDiscard(null) : close());
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onEscape.current();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, []);
  const confirmDiscard = () => {
    if (discard === 'select') {
      setItems([]);
      setCur(0);
      setTool(null);
      setStep('select');
    } else onClose();
    setDiscard(null);
  };

  const addFiles = async (list: FileList | null) => {
    if (!list?.length) return;
    const files = [...list].filter((f) => PHOTO.test(f.type) || VIDEO.test(f.type)).slice(0, MAX_ITEMS - items.length);
    if (!files.length) { setError('Choose photos (JPG, PNG, WebP) or videos (MP4, WebM).'); return; }
    setError(null);
    const added: Item[] = [];
    for (const f of files) {
      const url = URL.createObjectURL(f);
      urls.current.push(url);
      const video = VIDEO.test(f.type);
      let img: HTMLImageElement | undefined;
      if (!video) {
        try { img = await loadImage(url); } catch { continue; }
      }
      added.push({ key: `${f.name}-${f.size}-${Math.random().toString(36).slice(2)}`, file: f, url, video, img, edit: NEW_EDIT, alt: '' });
    }
    if (!added.length) { setError('Those files could not be opened.'); return; }
    if (!items.length && added[0].img) {
      // Start from the photo's own shape when it is within Instagram's range, otherwise a 4:5 portrait.
      const r = added[0].img.naturalWidth / added[0].img.naturalHeight;
      setAspect(r >= 0.8 && r <= 1.91 ? 'original' : '4:5');
    }
    setCur(items.length);
    setItems((x) => [...x, ...added]);
    setTextOnly(false);
    if (step === 'select') setStep('crop');
    if (fileRef.current) fileRef.current.value = '';
  };

  const setEdit = (patch: Partial<Edit>) => setItems((x) => x.map((it, i) => (i === cur ? { ...it, edit: { ...it.edit, ...patch } } : it)));
  const removeItem = (i: number) => {
    const next = items.filter((_, k) => k !== i);
    setItems(next);
    setCur(Math.max(0, Math.min(cur, next.length - 1)));
    if (!next.length) { setStep('select'); setTool(null); }
  };
  const moveItem = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    setItems(next);
    setCur(j);
  };

  const goDetails = () => {
    // Render each photo once at preview size for the final review.
    setFinals(items.map((it) => (it.img ? renderEdit(it.img, aspect, it.edit, 900).toDataURL('image/jpeg', 0.85) : it.url)));
    setStep('details');
    setTool(null);
  };
  const back = () => {
    setError(null);
    if (step === 'crop') setDiscard('select');
    else if (step === 'edit') setStep('crop');
    else if (step === 'details') {
      stopMusic();
      if (textOnly) { setTextOnly(false); setStep('select'); } else setStep('edit');
    }
  };

  const share = async () => {
    setBusy(true);
    setError(null);
    stopMusic();
    try {
      let media: string[] = [];
      if (!textOnly && items.length) {
        const files = await Promise.all(items.map((it, i) => (it.video || !it.img ? it.file : exportEdit(it.img, aspect, it.edit, it.file.name || `photo-${i + 1}.jpg`))));
        media = await uploadMedia(files);
      }
      let sound: Json | undefined;
      if (music?.file) {
        const [url] = await uploadMedia([music.file]);
        sound = { url, title: music.title, artist: music.artist, start: music.start };
      } else if (music?.track) sound = { track: music.track, title: music.title, artist: music.artist };
      const data: Json = {
        ...(kind === 'event' ? { event_date: eventDate || undefined, event_location: eventLoc || undefined } : {}),
        ...(media.length ? { aspect, alt: items.map((it) => it.alt) } : {}),
        location: location.trim() || undefined,
        tagged: tagged.map((t) => t.id),
        music: sound,
        hide_likes: hideLikes || undefined,
        comments_off: commentsOff || undefined,
      };
      const r = await post('/posts', { kind, body, media, data });
      window.dispatchEvent(new CustomEvent(POSTED_EVENT, { detail: r.post }));
      toast('Your post has been shared', 'success');
      onClose();
      nav('/');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const insertEmoji = (e: string) => {
    const el = caption.current;
    const at = el?.selectionStart ?? body.length;
    setBody((b) => (b.slice(0, at) + e + b.slice(at)).slice(0, MAX_CAPTION));
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(at + e.length, at + e.length); });
  };

  const title = step === 'select' ? 'Create new post' : step === 'crop' ? 'Crop' : step === 'edit' ? 'Edit' : 'Create new post';
  const wide = step === 'edit' || step === 'details';
  const nextBtn = step === 'crop' ? <button className="text-btn cp-next" onClick={() => { setStep('edit'); setTool(null); }}>Next</button>
    : step === 'edit' ? <button className="text-btn cp-next" onClick={goDetails}>Next</button>
    : step === 'details' ? <button className="text-btn cp-next" onClick={share} disabled={busy || (textOnly && !body.trim())}>{busy ? 'Sharing…' : 'Share'}</button>
    : null;
  const carousel = (n: number) => n > 1 && (
    <>
      {cur > 0 && <button className="carousel-btn" style={{ left: 12 }} onClick={() => setCur(cur - 1)} aria-label="Previous"><Icon name="chevronLeft" /></button>}
      {cur < n - 1 && <button className="carousel-btn" style={{ right: 12 }} onClick={() => setCur(cur + 1)} aria-label="Next"><Icon name="chevronRight" /></button>}
      <div className="carousel-dots">{Array.from({ length: n }, (_, k) => <i key={k} className={k === cur ? 'on' : ''} />)}</div>
    </>
  );

  return (
    <Portal>
      <div className="modal-backdrop creator-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
        <button className="creator-close" onClick={close} aria-label="Close"><Icon name="x" /></button>
        <div className={`creator${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
          <header className="creator-head">
            {step !== 'select' ? <button className="icon-btn" onClick={back} aria-label="Back"><Icon name="arrowLeft" /></button> : <button className="icon-btn" onClick={close} aria-label="Close"><Icon name="x" /></button>}
            <h3>{title}</h3>
            {nextBtn ?? <span />}
          </header>

          {step === 'select' && (
            <div
              className={`creator-select${over ? ' over' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setOver(true); }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => { e.preventDefault(); setOver(false); addFiles(e.dataTransfer.files); }}
            >
              <div className="creator-select-art" aria-hidden="true"><Icon name="image" /><Icon name="play" /></div>
              <p className="creator-select-title">Drag photos and videos here</p>
              <ErrorBox error={error} />
              <button className="btn btn-primary" onClick={() => fileRef.current?.click()}>Select from computer</button>
              <button className="text-btn" onClick={() => { setTextOnly(true); setStep('details'); }}>or write a text update</button>
            </div>
          )}
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm" multiple hidden onChange={(e) => addFiles(e.target.files)} />

          {step === 'crop' && item && (
            <div className="creator-stage">
              <CropFrame key={item.key} item={item} aspect={aspect} onEdit={setEdit} />
              {carousel(items.length)}
              <div className="cp-tools">
                <div className="cp-tool-group">
                  <div className="cp-tool">
                    <button className={`cp-tool-btn${tool === 'aspect' ? ' on' : ''}`} onClick={() => setTool(tool === 'aspect' ? null : 'aspect')} aria-label="Select crop"><Icon name="grid" /></button>
                    {tool === 'aspect' && (
                      <div className="cp-pop">
                        {ASPECTS.map((a) => <button key={a.id} className={aspect === a.id ? 'on' : ''} onClick={() => setAspect(a.id)}>{a.label}<span className={`ratio-glyph r${a.id.replace(':', '-')}`} /></button>)}
                      </div>
                    )}
                  </div>
                  {!item.video && (
                    <div className="cp-tool">
                      <button className={`cp-tool-btn${tool === 'zoom' ? ' on' : ''}`} onClick={() => setTool(tool === 'zoom' ? null : 'zoom')} aria-label="Zoom"><Icon name="search" /></button>
                      {tool === 'zoom' && (
                        <div className="cp-pop cp-pop-zoom">
                          <input type="range" min={1} max={3} step={0.01} value={item.edit.zoom} onChange={(e) => setEdit({ zoom: Number(e.target.value) })} aria-label="Zoom" />
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div className="cp-tool">
                  <button className={`cp-tool-btn${tool === 'gallery' ? ' on' : ''}`} onClick={() => setTool(tool === 'gallery' ? null : 'gallery')} aria-label="Open media gallery"><Icon name="layers" /></button>
                  {tool === 'gallery' && (
                    <div className="cp-pop cp-gallery">
                      {items.map((it, i) => (
                        <div key={it.key} className={`cp-thumb${i === cur ? ' on' : ''}`}>
                          <button className="cp-thumb-img" onClick={() => setCur(i)} aria-label={`Photo ${i + 1}`}>{it.video ? <video src={it.url} muted /> : <img src={it.url} alt="" />}</button>
                          <button className="cp-thumb-x" onClick={() => removeItem(i)} aria-label="Remove"><Icon name="x" size={12} /></button>
                          {i === cur && items.length > 1 && (
                            <span className="cp-thumb-move">
                              <button onClick={() => moveItem(i, -1)} disabled={i === 0} aria-label="Move earlier"><Icon name="chevronLeft" size={12} /></button>
                              <button onClick={() => moveItem(i, 1)} disabled={i === items.length - 1} aria-label="Move later"><Icon name="chevronRight" size={12} /></button>
                            </span>
                          )}
                        </div>
                      ))}
                      {items.length < MAX_ITEMS && <button className="cp-add" onClick={() => fileRef.current?.click()} aria-label="Add more"><Icon name="plus" /></button>}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {step === 'edit' && item && (
            <div className="creator-split">
              <div className="creator-stage">
                <EditPreview item={item} aspect={aspect} />
                {carousel(items.length)}
              </div>
              <aside className="creator-side">
                {item.video ? (
                  <p className="muted small" style={{ padding: 18 }}>Filters and adjustments are for photos. Your video is posted as recorded, framed {aspect === 'original' ? 'in its own shape' : `at ${aspect}`}.</p>
                ) : (
                  <>
                    <div className="cp-tabs">
                      <button className={editTab === 'filters' ? 'on' : ''} onClick={() => setEditTab('filters')}>Filters</button>
                      <button className={editTab === 'adjust' ? 'on' : ''} onClick={() => setEditTab('adjust')}>Adjustments</button>
                    </div>
                    {editTab === 'filters'
                      ? <FilterGrid item={item} aspect={aspect} onPick={(filter) => setEdit({ filter })} />
                      : <Adjustments value={item.edit.adjust} onChange={(adjust) => setEdit({ adjust })} />}
                  </>
                )}
              </aside>
            </div>
          )}

          {step === 'details' && (
            <div className="creator-split">
              <div className="creator-stage">
                {textOnly ? (
                  <div className="post-feature cp-text-preview" style={{ ['--feature-art' as string]: artBackground(`draft-${me?.user.id}`) }}>
                    <span className="post-kicker">{kind === 'text' ? 'Update' : label(kind)}</span>
                    <div className={`post-feature-text${body.length <= 180 ? ' lg' : ''}`}>{body || 'Your words, set large.'}</div>
                  </div>
                ) : (
                  <div className="cp-stage-inner">
                    <div className="cp-final">
                      {item?.video ? <video src={item.url} muted autoPlay loop playsInline /> : finals[cur] && <img src={finals[cur]} alt={item?.alt || ''} />}
                    </div>
                    {carousel(items.length)}
                  </div>
                )}
                {music && (
                  <button className="cp-sticker" onClick={() => toggleMusic('creator', { track: music.track, url: music.url, start: music.start })}>
                    <EqBars on={musicPlaying} /><span className="truncate">{music.title}</span><span className="muted truncate">· {music.artist}</span>
                  </button>
                )}
              </div>
              <aside className="creator-side">
                {panel === 'music' ? (
                  <MusicPanel value={music} onChange={setMusic} onDone={() => setPanel('main')} />
                ) : (
                  <div className="cp-details">
                    <div className="row" style={{ padding: '2px 2px 4px' }}><Avatar user={me?.user} size={30} /><b className="small">{me?.user.username}</b></div>
                    <ErrorBox error={error} />
                    <textarea ref={caption} className="cp-caption" autoFocus placeholder="Write a caption… use #hashtags and @mentions" value={body} onChange={(e) => setBody(e.target.value.slice(0, MAX_CAPTION))} />
                    <div className="row-between cp-caption-foot">
                      <div className="menu-anchor">
                        <button type="button" className="icon-btn" onClick={() => setEmoji((o) => !o)} aria-label="Emoji" aria-expanded={emoji}><Icon name="star" /></button>
                        {emoji && <div className="popover cp-emoji">{EMOJI.map((e) => <button key={e} type="button" onClick={() => insertEmoji(e)}>{e}</button>)}</div>}
                      </div>
                      <span className="xsmall muted">{body.length.toLocaleString()}/{MAX_CAPTION.toLocaleString()}</span>
                    </div>

                    <label className="cp-row">
                      <Icon name="mapPin" />
                      <input list="cp-cities" placeholder="Add location" value={location} onChange={(e) => setLocation(e.target.value.slice(0, 80))} />
                      <datalist id="cp-cities">{(meta?.cities ?? []).map((c) => <option key={c.name} value={c.name} />)}</datalist>
                    </label>
                    <Section icon="users" title="Tag people" aside={tagged.length ? <span className="chip chip-brand">{tagged.length}</span> : undefined}>
                      <TagPeople value={tagged} onChange={setTagged} />
                    </Section>
                    <div className="cp-row">
                      <button type="button" className="cp-row-btn" onClick={() => setPanel('music')}>
                        <Icon name="music" />
                        <span className="grow truncate">{music ? <><b>{music.title}</b> · {music.artist}</> : 'Add music'}</span>
                        {!music && <Icon name="chevronRight" />}
                      </button>
                      {music && <button type="button" className="icon-btn" onClick={() => { stopMusic(); setMusic(null); }} aria-label="Remove music"><Icon name="x" /></button>}
                    </div>
                    <Section icon="layers" title="Post type" aside={<span className="xsmall muted">{kind === 'text' ? 'Post' : label(kind)}</span>}>
                      <div className="row-wrap">{kinds.map((k) => <button key={k} type="button" className={`chip${kind === k ? ' active' : ''}`} onClick={() => setKind(k)}>{k === 'text' ? 'Post' : label(k)}</button>)}</div>
                      {kind === 'event' && (
                        <div className="stack-sm mt-sm">
                          <input className="input" type="datetime-local" value={eventDate} onChange={(e) => setEventDate(e.target.value)} aria-label="Event date" />
                          <input className="input" placeholder="Event venue" value={eventLoc} onChange={(e) => setEventLoc(e.target.value)} />
                        </div>
                      )}
                    </Section>
                    {!textOnly && items.some((it) => !it.video) && (
                      <Section icon="eye" title="Accessibility">
                        <p className="xsmall muted">Alt text describes your photos for people with visual impairments.</p>
                        {items.map((it, i) => !it.video && (
                          <div key={it.key} className="cp-alt">
                            <img src={finals[i] ?? it.url} alt="" />
                            <input className="input" placeholder="Write alt text…" value={it.alt} maxLength={300} onChange={(e) => setItems((x) => x.map((y, k) => (k === i ? { ...y, alt: e.target.value } : y)))} />
                          </div>
                        ))}
                      </Section>
                    )}
                    <Section icon="settings" title="Advanced settings">
                      <Toggle checked={hideLikes} onChange={setHideLikes} title="Hide like count on this post" hint="Only you will see the total number of likes. You can still see who liked it." />
                      <Toggle checked={commentsOff} onChange={setCommentsOff} title="Turn off commenting" hint="People won't be able to comment on this post." />
                    </Section>
                  </div>
                )}
              </aside>
            </div>
          )}

          {busy && <div className="creator-busy"><div className="spinner" /><span className="small bold">Sharing your post…</span></div>}
        </div>

        {discard && (
          <div className="creator-confirm" role="alertdialog" aria-label="Discard post?">
            <div className="creator-confirm-card">
              <h3>Discard post?</h3>
              <p className="small muted">If you leave, your edits won't be saved.</p>
              <button className="btn btn-block cp-danger" onClick={confirmDiscard}>Discard</button>
              <button className="btn btn-ghost btn-block" onClick={() => setDiscard(null)}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </Portal>
  );
}
