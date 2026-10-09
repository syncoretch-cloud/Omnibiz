import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Icon } from './Icon.tsx';
import { Artwork, postArt } from './Artwork.tsx';
import { Avatar, ErrorBox, Modal } from './ui.tsx';
import { post, uploadMedia } from '../lib/api.ts';
import { isBusinessType, useSession, useToast } from '../lib/session.tsx';
import { label } from '../lib/format.ts';

export const POSTED_EVENT = 'omnibiz:posted';

/** Instagram-style "Create new post": media (or a generated cover) on the left, caption on the right. */
export function CreatePostModal({ onClose }: { onClose: () => void }) {
  const { me, meta } = useSession();
  const toast = useToast();
  const nav = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [media, setMedia] = useState<string[]>([]);
  const [idx, setIdx] = useState(0);
  const [body, setBody] = useState('');
  const [kind, setKind] = useState('text');
  const [eventDate, setEventDate] = useState('');
  const [eventLoc, setEventLoc] = useState('');
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const biz = isBusinessType(me?.user.account_type);
  const kinds = (meta?.post_kinds ?? ['text']).filter((k) => biz || ['text', 'news', 'event', 'update'].includes(k));

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    setError(null);
    try {
      const urls = await uploadMedia([...files].slice(0, 10 - media.length));
      setMedia((m) => [...m, ...urls]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const share = async () => {
    setBusy(true);
    setError(null);
    try {
      const data = kind === 'event' ? { event_date: eventDate || undefined, event_location: eventLoc || undefined } : {};
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

  const preview = { id: 'draft', kind, body: body || 'Your words become the cover', data: { event_date: eventDate || undefined, event_location: eventLoc || undefined }, author: me?.user, tags: [] };
  const current = media[Math.min(idx, media.length - 1)];

  return (
    <Modal
      large
      title="Create new post"
      onClose={onClose}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={share} disabled={busy || uploading || (!body.trim() && !media.length)}>{busy ? 'Sharing…' : 'Share'}</button></>}
    >
      <div className="create-grid">
        <div className="stack-sm">
          {media.length ? (
            <div className="ig-media" style={{ position: 'relative' }}>
              {/\.(mp4|webm)$/i.test(current) ? <video src={current} controls /> : <img src={current} alt="" />}
              <button className="save-btn" onClick={() => { setMedia((m) => m.filter((x) => x !== current)); setIdx(0); }} aria-label="Remove"><Icon name="x" /></button>
            </div>
          ) : (
            <div
              className={`drop${over ? ' over' : ''}`}
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setOver(true); }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => { e.preventDefault(); setOver(false); upload(e.dataTransfer.files); }}
              style={{ padding: 0, overflow: 'hidden', border: 0, position: 'relative' }}
            >
              <Artwork variant="post" {...postArt(preview)} seed={`draft-${me?.user.id}-${kind}`} />
              <div style={{ position: 'absolute', top: 14, right: 14, zIndex: 4 }}>
                <span className="btn btn-glass btn-sm"><Icon name="image" />{uploading ? 'Uploading…' : 'Add photos or video'}</span>
              </div>
            </div>
          )}
          {media.length > 0 && (
            <div className="row-wrap">
              {media.map((m, i) => (
                <button key={m} onClick={() => setIdx(i)} style={{ width: 56, height: 56, borderRadius: 12, overflow: 'hidden', padding: 0, border: i === idx ? '2px solid var(--brand)' : '2px solid transparent', cursor: 'pointer' }}>
                  {/\.(mp4|webm)$/i.test(m) ? <video src={m} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <img src={m} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                </button>
              ))}
              {media.length < 10 && <button className="btn btn-icon" onClick={() => fileRef.current?.click()} aria-label="Add more" disabled={uploading}><Icon name="plus" /></button>}
            </div>
          )}
          <input ref={fileRef} type="file" accept="image/*,video/mp4,video/webm" multiple hidden onChange={(e) => upload(e.target.files)} />
        </div>
        <div className="stack">
          <div className="row"><Avatar user={me?.user} size={36} /><b>{me?.user.username}</b></div>
          <ErrorBox error={error} />
          <textarea className="textarea" autoFocus placeholder="Write a caption… use #hashtags and @mentions" value={body} onChange={(e) => setBody(e.target.value)} maxLength={5000} style={{ minHeight: 170 }} />
          <div className="xsmall muted" style={{ textAlign: 'right', marginTop: -10 }}>{body.length.toLocaleString()}/5,000</div>
          <div>
            <div className="label" style={{ marginBottom: 8 }}>Type</div>
            <div className="row-wrap">
              {kinds.map((k) => <button key={k} type="button" className={`chip${kind === k ? ' active' : ''}`} onClick={() => setKind(k)}>{k === 'text' ? 'Post' : label(k)}</button>)}
            </div>
          </div>
          {kind === 'event' && (
            <div className="stack-sm">
              <input className="input" type="datetime-local" value={eventDate} onChange={(e) => setEventDate(e.target.value)} aria-label="Event date" />
              <input className="input" placeholder="Event location" value={eventLoc} onChange={(e) => setEventLoc(e.target.value)} />
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
