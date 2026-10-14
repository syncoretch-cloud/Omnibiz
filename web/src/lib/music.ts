// Music for posts and reels. "OmniBiz Sounds" is a library of tracks composed in code and played with the
// Web Audio API (no recordings, so no licensing); authors can also upload their own audio. One player for the
// whole app makes sure only one sound plays at a time.
import { useSyncExternalStore } from 'react';

type Style = 'afro' | 'amapiano' | 'lofi' | 'chill' | 'bongo';
export const STYLE_NAMES: Record<Style, string> = { afro: 'Afrobeats', amapiano: 'Amapiano', lofi: 'Lo-fi', chill: 'Chill', bongo: 'Bongo Flava' };
export interface Track { id: string; title: string; artist: string; mood: string; style: Style; bpm: number; root: number; minor: boolean; prog: number[] }

const ARTIST = 'OmniBiz Sounds';
export const TRACKS: Track[] = [
  { id: 'kariakoo-morning', title: 'Kariakoo Morning', artist: ARTIST, mood: 'Upbeat', style: 'afro', bpm: 104, root: 57, minor: true, prog: [0, 5, 2, 6] },
  { id: 'dar-night-drive', title: 'Dar Night Drive', artist: ARTIST, mood: 'Groovy', style: 'amapiano', bpm: 112, root: 50, minor: true, prog: [0, 0, 5, 3] },
  { id: 'zanzibar-breeze', title: 'Zanzibar Breeze', artist: ARTIST, mood: 'Calm', style: 'chill', bpm: 88, root: 53, minor: false, prog: [0, 4, 5, 3] },
  { id: 'bongo-bounce', title: 'Bongo Bounce', artist: ARTIST, mood: 'Happy', style: 'bongo', bpm: 98, root: 52, minor: false, prog: [0, 3, 4, 3] },
  { id: 'arusha-coffee', title: 'Arusha Coffee', artist: ARTIST, mood: 'Chill', style: 'lofi', bpm: 82, root: 55, minor: false, prog: [1, 4, 0, 5] },
  { id: 'mwanza-lights', title: 'Mwanza Lights', artist: ARTIST, mood: 'Party', style: 'amapiano', bpm: 113, root: 56, minor: true, prog: [0, 5, 6, 4] },
  { id: 'serengeti-gold', title: 'Serengeti Gold', artist: ARTIST, mood: 'Warm', style: 'chill', bpm: 76, root: 48, minor: false, prog: [0, 5, 3, 4] },
  { id: 'kilimanjaro-rise', title: 'Kilimanjaro Rise', artist: ARTIST, mood: 'Inspiring', style: 'afro', bpm: 100, root: 48, minor: false, prog: [3, 4, 0, 5] },
  { id: 'pemba-waves', title: 'Pemba Waves', artist: ARTIST, mood: 'Sunny', style: 'lofi', bpm: 78, root: 57, minor: false, prog: [0, 5, 3, 4] },
  { id: 'uhuru-groove', title: 'Uhuru Groove', artist: ARTIST, mood: 'Energetic', style: 'bongo', bpm: 101, root: 51, minor: true, prog: [0, 3, 6, 5] },
  { id: 'lake-victoria', title: 'Lake Victoria', artist: ARTIST, mood: 'Dreamy', style: 'chill', bpm: 70, root: 50, minor: false, prog: [0, 2, 5, 4] },
  { id: 'msasani-sunset', title: 'Msasani Sunset', artist: ARTIST, mood: 'Romantic', style: 'lofi', bpm: 84, root: 54, minor: true, prog: [0, 5, 2, 6] },
];
export const trackById = (id?: string) => TRACKS.find((t) => t.id === id);

// 16-step patterns per style: kick, clap/snare, shaker/hat, bass, chord stabs ('-' = held pad), arpeggio.
const PATTERNS: Record<Style, { kick: string; snare: string; hat: string; bass: string; chord: string; arp: string; swing?: number; logDrum?: boolean }> = {
  afro: { kick: 'x.....x...x.....', snare: '....x.......x...', hat: 'x.xxx.xxx.xxx.xx', bass: 'x..x..x...x.x...', chord: '..x...x...x...x.', arp: '' },
  amapiano: { kick: 'x...x...x...x...', snare: '....x.......x...', hat: 'xxxxxxxxxxxxxxxx', bass: '...x..x...x.x..x', chord: '-...............', arp: '', logDrum: true },
  lofi: { kick: 'x.......x.x.....', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.', bass: 'x.......x.......', chord: '-...............', arp: '', swing: 0.18 },
  chill: { kick: 'x.......x.......', snare: '', hat: '..x...x...x...x.', bass: 'x...............', chord: '-...............', arp: 'x.x.x.x.x.x.x.x.' },
  bongo: { kick: 'x..x...x..x.....', snare: '....x..x....x...', hat: 'x.x.x.x.x.x.x.x.', bass: 'x..x...x..x.x...', chord: 'x...x...x...x...', arp: '..x..x....x..x..' },
};
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

/** MIDI notes of the triad built on a scale degree. */
function triad(t: Track, degree: number) {
  const scale = t.minor ? MINOR : MAJOR;
  return [0, 2, 4].map((k) => {
    const i = degree + k;
    return t.root + scale[i % 7] + 12 * Math.floor(i / 7);
  });
}

class Synth {
  private ctx: AudioContext;
  private out: GainNode;
  private noise: AudioBuffer;
  private timer = 0;
  private step = 0;
  private next = 0;
  constructor(private track: Track) {
    this.ctx = new AudioContext();
    const comp = this.ctx.createDynamicsCompressor();
    this.out = this.ctx.createGain();
    this.out.gain.value = 0.32;
    this.out.connect(comp).connect(this.ctx.destination);
    this.noise = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  start() {
    this.next = this.ctx.currentTime + 0.06;
    const tick = () => {
      const stepDur = 60 / this.track.bpm / 4;
      while (this.next < this.ctx.currentTime + 0.15) {
        const p = PATTERNS[this.track.style];
        const swing = p.swing && this.step % 2 ? stepDur * p.swing : 0;
        this.schedule(this.step, this.next + swing, stepDur);
        this.next += stepDur;
        this.step++;
      }
    };
    tick();
    this.timer = window.setInterval(tick, 25);
  }
  stop() {
    clearInterval(this.timer);
    const t = this.ctx.currentTime;
    this.out.gain.setTargetAtTime(0, t, 0.05);
    setTimeout(() => this.ctx.close().catch(() => {}), 300);
  }
  private schedule(step: number, t: number, stepDur: number) {
    const p = PATTERNS[this.track.style];
    const s = step % 16;
    const bar = Math.floor(step / 16) % this.track.prog.length;
    const chord = triad(this.track, this.track.prog[bar]);
    const on = (pat: string) => pat[s] === 'x';
    if (on(p.kick)) this.kick(t);
    if (on(p.snare)) this.clap(t);
    if (on(p.hat)) this.hat(t, s % 4 === 0 ? 0.09 : 0.05);
    if (on(p.bass)) {
      const note = chord[0] - 24 + (p.logDrum && s % 8 === 6 ? 7 : 0);
      if (p.logDrum) this.logDrum(t, hz(note)); else this.bass(t, hz(note), stepDur * 2.5);
    }
    if (p.chord[s] === '-') chord.forEach((n) => this.pad(t, hz(n), stepDur * 15.5));
    else if (on(p.chord)) chord.forEach((n) => this.pluck(t, hz(n + 12), 0.22, 0.05));
    if (p.arp && on(p.arp)) this.pluck(t, hz(chord[(step >> 1) % 3] + 12 + ((step >> 3) % 2) * 12), 0.3, 0.06);
  }
  private env(t: number, peak: number, attack: number, decay: number) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    g.connect(this.out);
    return g;
  }
  private osc(type: OscillatorType, f: number, t: number, len: number, dest: AudioNode) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    o.connect(dest);
    o.start(t);
    o.stop(t + len);
    return o;
  }
  private kick(t: number) {
    const o = this.osc('sine', 150, t, 0.4, this.env(t, 0.9, 0.005, 0.33));
    o.frequency.exponentialRampToValueAtTime(44, t + 0.12);
  }
  private noiseHit(t: number, type: BiquadFilterType, f: number, peak: number, decay: number) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const filt = this.ctx.createBiquadFilter();
    filt.type = type;
    filt.frequency.value = f;
    src.connect(filt).connect(this.env(t, peak, 0.002, decay));
    src.start(t);
    src.stop(t + decay + 0.05);
  }
  private clap(t: number) { this.noiseHit(t, 'bandpass', 1700, 0.42, 0.16); }
  private hat(t: number, peak: number) { this.noiseHit(t, 'highpass', 7200, peak, 0.04); }
  private bass(t: number, f: number, len: number) {
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 600;
    lp.connect(this.env(t, 0.55, 0.01, len));
    this.osc('triangle', f, t, len + 0.05, lp);
  }
  private logDrum(t: number, f: number) {
    const o = this.osc('sine', f * 1.6, t, 0.5, this.env(t, 0.75, 0.004, 0.42));
    o.frequency.exponentialRampToValueAtTime(f, t + 0.05);
  }
  private pad(t: number, f: number, len: number) {
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1100;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.06, t + 0.4);
    g.gain.setValueAtTime(0.06, t + len - 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    lp.connect(g).connect(this.out);
    this.osc('sawtooth', f * 0.997, t, len, lp);
    this.osc('triangle', f * 1.003, t, len, lp);
  }
  private pluck(t: number, f: number, decay: number, peak: number) {
    this.osc('triangle', f, t, decay + 0.05, this.env(t, peak, 0.004, decay));
  }
}

// ───────────── one player for the whole app ─────────────
export interface MusicSource { track?: string; url?: string; start?: number }
let playing: string | null = null;
let synth: Synth | null = null;
let audio: HTMLAudioElement | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function stopMusic() {
  synth?.stop();
  synth = null;
  if (audio) { audio.pause(); audio = null; }
  if (playing !== null) { playing = null; emit(); }
}

/** Plays a source under a key (e.g. "post-12"); starting another key stops the previous sound. */
export function playMusic(key: string, src: MusicSource) {
  stopMusic();
  const t = trackById(src.track);
  if (t) {
    synth = new Synth(t);
    synth.start();
  } else if (src.url) {
    audio = new Audio(src.url);
    audio.loop = true;
    audio.currentTime = src.start ?? 0;
    audio.play().catch(() => stopMusic());
  } else return;
  playing = key;
  emit();
}

/** Stops only if `key` is still the sound playing (another post may have taken over). */
export function stopMusicIf(key: string) {
  if (playing === key) stopMusic();
}

export function toggleMusic(key: string, src: MusicSource) {
  if (playing === key) stopMusic();
  else playMusic(key, src);
}

/** True while the given key is the one playing. */
export function usePlaying(key: string) {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    () => playing === key,
  );
}
