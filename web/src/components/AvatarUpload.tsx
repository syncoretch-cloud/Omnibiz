import { useRef, useState } from 'react';
import { patch, uploadMedia } from '../lib/api.ts';
import { loadImage } from '../lib/imageEdit.ts';
import { useSession, useToast } from '../lib/session.tsx';

const MAX_BYTES = 10 * 1024 * 1024;
const SIDE = 512;

/** Centre-crops a picture to a square so every profile picture frames the same way, and shrinks it for fast loading. */
async function squareCrop(file: File): Promise<File> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const s = Math.min(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = Math.min(SIDE, s);
    canvas.getContext('2d')!.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, canvas.width, canvas.height);
    // Logos keep their transparency; photos are smaller as JPEG.
    const type = file.type === 'image/png' || file.type === 'image/webp' ? 'image/png' : 'image/jpeg';
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, type, 0.9));
    if (!blob) return file;
    return new File([blob], `profile.${type === 'image/png' ? 'png' : 'jpg'}`, { type });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Change or remove your profile picture (a business's logo). It saves the moment you choose a picture, and updates the whole app. */
export function useAvatarUpload() {
  const { me, setMe } = useSession();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const biz = !!me && ['company', 'wholesaler', 'retailer'].includes(me.user.account_type);

  const save = async (avatar_url: string, done: string) => {
    const r = await patch('/users/me', { avatar_url });
    setMe(r);
    toast(done, 'success');
  };
  const onFile = async (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) return toast('Choose an image (JPG, PNG or WebP).', 'error');
    if (file.size > MAX_BYTES) return toast('That picture is over 10 MB. Choose a smaller one.', 'error');
    setBusy(true);
    try {
      const [url] = await uploadMedia([await squareCrop(file)]);
      await save(url, biz ? 'Logo updated' : 'Profile picture updated');
    } catch (e) {
      toast((e as Error).message || 'Could not upload that picture.', 'error');
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    setBusy(true);
    try {
      await save('', biz ? 'Logo removed' : 'Profile picture removed');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  /** Render once near the button that calls `open`. */
  const field = (
    <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden
      onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; void onFile(f); }} />
  );
  return { open: () => input.current?.click(), remove, busy, field, has: !!me?.user.avatar_url, biz };
}
