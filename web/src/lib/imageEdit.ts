// Photo editing for the create flow: crop to a ratio with zoom and pan, a filter, and fine adjustments.
// The same pixel pipeline draws the live preview and the exported upload, so what you see is what is posted.

export type Aspect = 'original' | '1:1' | '4:5' | '16:9';
export const ASPECTS: { id: Aspect; label: string }[] = [
  { id: 'original', label: 'Original' },
  { id: '1:1', label: '1:1' },
  { id: '4:5', label: '4:5' },
  { id: '16:9', label: '16:9' },
];

export interface Adjust {
  brightness: number; // -100…100
  contrast: number; // -100…100
  saturation: number; // -100…100
  warmth: number; // -100…100
  fade: number; // 0…100
  vignette: number; // 0…100
}
export const NO_ADJUST: Adjust = { brightness: 0, contrast: 0, saturation: 0, warmth: 0, fade: 0, vignette: 0 };
export const ADJUSTMENTS: { key: keyof Adjust; label: string; min: number }[] = [
  { key: 'brightness', label: 'Brightness', min: -100 },
  { key: 'contrast', label: 'Contrast', min: -100 },
  { key: 'saturation', label: 'Saturation', min: -100 },
  { key: 'warmth', label: 'Warmth', min: -100 },
  { key: 'fade', label: 'Fade', min: 0 },
  { key: 'vignette', label: 'Vignette', min: 0 },
];

interface FilterDef { id: string; name: string; adjust: Partial<Adjust>; tint?: [number, number, number, number] }
/** Filters named after places across Tanzania. Each is a recipe of adjustments plus an optional colour wash. */
export const FILTERS: FilterDef[] = [
  { id: 'normal', name: 'Normal', adjust: {} },
  { id: 'kilimanjaro', name: 'Kilimanjaro', adjust: { brightness: 10, contrast: 14, saturation: -8, warmth: -18 } },
  { id: 'zanzibar', name: 'Zanzibar', adjust: { saturation: 28, warmth: 22, contrast: 8 } },
  { id: 'serengeti', name: 'Serengeti', adjust: { warmth: 34, fade: 18, contrast: -6 }, tint: [232, 159, 110, 0.08] },
  { id: 'arusha', name: 'Arusha', adjust: { contrast: 30, saturation: 10, vignette: 30 } },
  { id: 'mwanza', name: 'Mwanza', adjust: { warmth: -30, saturation: -6, brightness: 4 }, tint: [64, 90, 140, 0.08] },
  { id: 'dodoma', name: 'Dodoma', adjust: { fade: 30, saturation: -22, contrast: -10, brightness: 6 } },
  { id: 'moshi', name: 'Moshi', adjust: { saturation: -100, contrast: 16 } },
  { id: 'tanga', name: 'Tanga', adjust: { warmth: 26, fade: 26, saturation: -12 }, tint: [184, 92, 74, 0.1] },
  { id: 'pemba', name: 'Pemba', adjust: { saturation: 42, contrast: 14, brightness: 4 } },
  { id: 'mafia', name: 'Mafia', adjust: { contrast: 12, saturation: 10 }, tint: [30, 110, 120, 0.12] },
  { id: 'ngorongoro', name: 'Ngorongoro', adjust: { brightness: -12, contrast: 22, vignette: 45, warmth: 8 } },
];

export interface Edit {
  zoom: number; // 1…3
  x: number; // pan, -1…1 across the spare width
  y: number; // pan, -1…1 across the spare height
  filter: string;
  adjust: Adjust;
}
export const NEW_EDIT: Edit = { zoom: 1, x: 0, y: 0, filter: 'normal', adjust: NO_ADJUST };

export function ratioOf(aspect: Aspect, w: number, h: number) {
  if (aspect === 'original') return Math.min(1.91, Math.max(0.8, w / h)); // Instagram keeps photos between 4:5 and 1.91:1
  const [a, b] = aspect.split(':').map(Number);
  return a / b;
}

/** The part of the source image that fills the frame, in source pixels. */
export function cropRect(w: number, h: number, aspect: Aspect, e: Pick<Edit, 'zoom' | 'x' | 'y'>) {
  const r = ratioOf(aspect, w, h);
  let sw = w / h > r ? h * r : w;
  let sh = w / h > r ? h : w / r;
  sw /= e.zoom;
  sh /= e.zoom;
  const cx = w / 2 + e.x * (w - sw) / 2;
  const cy = h / 2 + e.y * (h - sh) / 2;
  return { sx: cx - sw / 2, sy: cy - sh / 2, sw, sh };
}

/** The filter's recipe combined with the user's own adjustments. */
function combined(e: Edit) {
  const f = FILTERS.find((x) => x.id === e.filter) ?? FILTERS[0];
  const a = { ...NO_ADJUST };
  for (const k of Object.keys(a) as (keyof Adjust)[]) a[k] = Math.max(-100, Math.min(100, (f.adjust[k] ?? 0) + e.adjust[k]));
  return { a, tint: f.tint };
}

const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

/** Applies brightness, contrast, fade, saturation, warmth, tint and vignette to canvas pixels in place. */
function grade(ctx: CanvasRenderingContext2D, width: number, height: number, e: Edit) {
  const { a, tint } = combined(e);
  if (Object.values(a).every((v) => v === 0) && !tint) return;
  const img = ctx.getImageData(0, 0, width, height);
  const d = img.data;
  const b = 1 + (a.brightness / 100) * 0.4;
  const c = 1 + (a.contrast / 100) * 0.6;
  const fade = (a.fade / 100) * 0.28;
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) lut[i] = clamp(((i * b - 128) * c + 128) * (1 - fade) + 236 * fade);
  const s = 1 + a.saturation / 100;
  const warm = (a.warmth / 100) * 28;
  const vig = (a.vignette / 100) * 0.6;
  const cx = width / 2;
  const cy = height / 2;
  const maxD = Math.hypot(cx, cy);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      let r = lut[d[i]];
      let g = lut[d[i + 1]];
      let bl = lut[d[i + 2]];
      if (s !== 1) {
        const l = 0.299 * r + 0.587 * g + 0.114 * bl;
        r = l + (r - l) * s;
        g = l + (g - l) * s;
        bl = l + (bl - l) * s;
      }
      if (warm) { r += warm; bl -= warm; }
      if (tint) {
        r = r * (1 - tint[3]) + tint[0] * tint[3];
        g = g * (1 - tint[3]) + tint[1] * tint[3];
        bl = bl * (1 - tint[3]) + tint[2] * tint[3];
      }
      if (vig) {
        const k = 1 - vig * (Math.hypot(x - cx, y - cy) / maxD) ** 2;
        r *= k; g *= k; bl *= k;
      }
      d[i] = clamp(r); d[i + 1] = clamp(g); d[i + 2] = clamp(bl);
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Draws the cropped, graded photo into a canvas whose longer side is at most `maxSide` pixels. */
export function renderEdit(img: HTMLImageElement, aspect: Aspect, e: Edit, maxSide: number, canvas = document.createElement('canvas')) {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const { sx, sy, sw, sh } = cropRect(w, h, aspect, e);
  const scale = Math.min(1, maxSide / Math.max(sw, sh));
  canvas.width = Math.max(1, Math.round(sw * scale));
  canvas.height = Math.max(1, Math.round(sh * scale));
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  grade(ctx, canvas.width, canvas.height, e);
  return canvas;
}

/** The final upload: 1440px on the long side, JPEG. */
export function exportEdit(img: HTMLImageElement, aspect: Aspect, e: Edit, name: string): Promise<File> {
  const canvas = renderEdit(img, aspect, e, 1440);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(new File([blob], name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' })) : reject(new Error('Could not process the photo'))), 'image/jpeg', 0.9);
  });
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not open that image'));
    img.src = src;
  });
}
