import { useRef, useState } from 'react';
import { Icon } from './Icon.tsx';
import { Avatar, Select } from './ui.tsx';
import { post, uploadMedia } from '../lib/api.ts';
import type { Json } from '../lib/api.ts';
import { isBusinessType, useAction, useSession } from '../lib/session.tsx';
import { label } from '../lib/format.ts';

export function MediaPicker({ value, onChange, max = 10, accept = 'image/*,video/mp4,video/webm' }: { value: string[]; onChange: (v: string[]) => void; max?: number; accept?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const act = useAction();
  const pick = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    const urls = await act(() => uploadMedia([...files].slice(0, max - value.length)));
    setBusy(false);
    if (urls) onChange([...value, ...urls]);
    if (ref.current) ref.current.value = '';
  };
  return (
    <div className="row-wrap">
      {value.map((m) => (
        <div key={m} style={{ position: 'relative', width: 84, height: 84, borderRadius: 8, overflow: 'hidden', background: 'var(--surface-2)' }}>
          {/\.(mp4|webm)$/i.test(m) ? <video src={m} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <img src={m} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
          <button type="button" className="save-btn" style={{ top: 4, right: 4, width: 24, height: 24 }} onClick={() => onChange(value.filter((x) => x !== m))} aria-label="Remove"><Icon name="x" size={14} /></button>
        </div>
      ))}
      {value.length < max && (
        <button type="button" className="btn btn-outline btn-sm" onClick={() => ref.current?.click()} disabled={busy}>
          <Icon name="image" />{busy ? 'Uploading…' : 'Add photos / video'}
        </button>
      )}
      <input ref={ref} type="file" accept={accept} multiple hidden onChange={(e) => pick(e.target.files)} />
    </div>
  );
}

export function Composer({ onPosted }: { onPosted: (p: Json) => void }) {
  const { me, meta, can } = useSession();
  const act = useAction();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState('');
  const [media, setMedia] = useState<string[]>([]);
  const [kind, setKind] = useState('text');
  const [eventDate, setEventDate] = useState('');
  const [eventLoc, setEventLoc] = useState('');
  const [busy, setBusy] = useState(false);
  if (!can('create_posts')) return null;
  const biz = isBusinessType(me?.user.account_type);
  const kinds = (meta?.post_kinds ?? ['text']).filter((k) => biz || ['text', 'news', 'event', 'update'].includes(k));

  const submit = async () => {
    setBusy(true);
    const data = kind === 'event' ? { event_date: eventDate || undefined, event_location: eventLoc || undefined } : {};
    const r = await act(() => post('/posts', { kind, body, media, data }), 'Posted');
    setBusy(false);
    if (r) {
      onPosted(r.post);
      setBody(''); setMedia([]); setKind('text'); setEventDate(''); setEventLoc(''); setOpen(false);
    }
  };

  return (
    <div className="card card-pad">
      <div className="row">
        <Avatar user={me?.user} size={44} />
        {!open ? (
          <button className="input search-input" style={{ textAlign: 'left', cursor: 'text', color: 'var(--muted)' }} onClick={() => setOpen(true)}>
            {biz ? 'Share an update, product, offer or event…' : 'Start a post…'}
          </button>
        ) : (
          <div className="grow muted small">Posting as <b>{me?.user.display_name}</b></div>
        )}
      </div>
      {open && (
        <div className="stack mt">
          <textarea
            className="textarea"
            autoFocus
            placeholder="What do you want to share? Use #hashtags and @mentions."
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={5000}
            style={{ minHeight: 120 }}
          />
          {kind === 'event' && (
            <div className="form-grid">
              <input className="input" type="datetime-local" value={eventDate} onChange={(e) => setEventDate(e.target.value)} aria-label="Event date" />
              <input className="input" placeholder="Event location" value={eventLoc} onChange={(e) => setEventLoc(e.target.value)} />
            </div>
          )}
          <MediaPicker value={media} onChange={setMedia} />
          <div className="row-between" style={{ flexWrap: 'wrap' }}>
            <Select value={kind} onChange={(e) => setKind(e.target.value)} options={kinds.map((k) => ({ value: k, label: k === 'text' ? 'Post' : label(k) }))} style={{ width: 'auto' }} aria-label="Post type" />
            <div className="row">
              <button className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={submit} disabled={busy || (!body.trim() && !media.length)}>Post</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
