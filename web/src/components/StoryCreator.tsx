import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon.tsx';
import { artBackground } from './Artwork.tsx';
import { ErrorBox, Portal } from './ui.tsx';
import { post, uploadMedia } from '../lib/api.ts';
import { useToast } from '../lib/session.tsx';
import { TRACKS, stopMusic, toggleMusic, usePlaying } from '../lib/music.ts';

export const STORY_EVENT = 'omnibiz:story';
/** Background seeds for text stories; each gives a different brand-colour gradient. */
const BACKGROUNDS = ['sunset', 'plum', 'ember', 'midnight', 'vanilla', 'rose'];
const MEDIA = /^(image\/(jpeg|png|webp|gif)|video\/(mp4|webm))$/;

/** Add to your story: a photo or video with an optional caption, or a text card on a gradient, with optional music. */
export function StoryCreator({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [bg, setBg] = useState(BACKGROUNDS[0]);
  const [track, setTrack] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const previewing = usePlaying('story-draft');
  const video = !!file?.type.startsWith('video/');

  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('keydown', esc); stopMusic(); };
  }, [onClose]);

  const pick = (f?: File) => {
    if (!f) return;
    if (!MEDIA.test(f.type)) { setError('Choose a photo (JPG, PNG, WebP, GIF) or a video (MP4, WebM).'); return; }
    setError(null);
    setFile(f);
    setUrl(URL.createObjectURL(f));
  };
  const clearMedia = () => { setFile(null); setUrl(''); if (fileRef.current) fileRef.current.value = ''; };

  const share = async () => {
    if (!file && !text.trim()) { setError('Add a photo, a video or some text.'); return; }
    setBusy(true);
    setError(null);
    stopMusic();
    try {
      const media = file ? (await uploadMedia([file]))[0] : undefined;
      const t = TRACKS.find((x) => x.id === track);
      await post('/stories', { media, body: text.trim() || undefined, bg: file ? undefined : bg, music: t ? { track: t.id, title: t.title, artist: t.artist } : undefined });
      window.dispatchEvent(new Event(STORY_EVENT));
      toast('Added to your story. It disappears after 24 hours.', 'success');
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Portal>
      <div className="modal-backdrop story-creator-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        <div className="story-creator" role="dialog" aria-label="Add to your story">
          <div className="story-creator-preview" style={file ? undefined : { background: artBackground(`story-bg-${bg}`) }}>
            {file ? (
              <>
                {video ? <video src={url} autoPlay muted loop playsInline /> : <img src={url} alt="" />}
                {text.trim() && <div className="story-caption">{text}</div>}
                <button className="btn btn-glass btn-icon btn-sm story-creator-clear" onClick={clearMedia} aria-label="Remove photo or video"><Icon name="x" /></button>
              </>
            ) : (
              <textarea className="story-creator-text" placeholder="Type something…" value={text} onChange={(e) => setText(e.target.value.slice(0, 300))} aria-label="Story text" autoFocus />
            )}
            {track && <span className="story-creator-music"><Icon name="music" />{TRACKS.find((x) => x.id === track)?.title}</span>}
          </div>

          <div className="story-creator-side">
            <div className="row-between">
              <h3>Add to your story</h3>
              <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
            </div>
            <ErrorBox error={error} />
            <button className="btn btn-outline btn-block" onClick={() => fileRef.current?.click()}><Icon name="image" />{file ? 'Choose another photo or video' : 'Photo or video'}</button>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm" hidden onChange={(e) => pick(e.target.files?.[0])} />
            {file ? (
              <label className="field"><span className="label">Caption (optional)</span><input className="input" value={text} maxLength={300} onChange={(e) => setText(e.target.value)} placeholder="Say something about it" /></label>
            ) : (
              <div className="field">
                <span className="label">Background</span>
                <div className="story-swatches">
                  {BACKGROUNDS.map((b) => <button key={b} className={`story-swatch${bg === b ? ' on' : ''}`} style={{ background: artBackground(`story-bg-${b}`) }} onClick={() => setBg(b)} aria-label={`Background ${b}`} aria-pressed={bg === b} />)}
                </div>
              </div>
            )}
            <div className="field">
              <span className="label">Music (optional)</span>
              <div className="row">
                <select className="select" value={track} onChange={(e) => { setTrack(e.target.value); stopMusic(); }} aria-label="Music">
                  <option value="">No music</option>
                  {TRACKS.map((t) => <option key={t.id} value={t.id}>{t.title} · {t.mood}</option>)}
                </select>
                {track && <button className="btn btn-outline btn-icon" onClick={() => toggleMusic('story-draft', { track })} aria-label={previewing ? 'Stop preview' : 'Preview music'}><Icon name={previewing ? 'pause' : 'play'} /></button>}
              </div>
            </div>
            <p className="xsmall muted">Your story is shown to your followers and people nearby for 24 hours. You can see who viewed it.</p>
            <button className="btn btn-primary btn-lg btn-block" disabled={busy || (!file && !text.trim())} onClick={share}><Icon name="send" />{busy ? 'Sharing…' : 'Share to story'}</button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
