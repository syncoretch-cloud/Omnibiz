// Automatic first look at what people write. Two tiers, both editable from OmniBiz Manager:
//   block  - rejected on the spot with an error (explicit sexual content, slurs, child-abuse terms)
//   review - published as "flagged" and held for a moderator (profanity and words that are only sometimes a problem)
// Matching is on whole words, ignores letter case and the usual look-alike swaps ("p0rn", "a$$", "pooorn").
import fs from 'node:fs';
import path from 'node:path';
import { all, get, run, tx } from '../db/index.ts';
import { HttpError } from '../lib/http.ts';
import { getSetting, setSetting } from './settings.ts';

export type TermAction = 'block' | 'review';

/** Loads the starting lists once, and again only when the file's version goes up, so edits made in the manager stick. */
export function ensureBlockedTerms() {
  const seed = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'db', 'moderation-terms.json'), 'utf8')) as { version: number; block: string[]; review: string[] };
  if (Number(getSetting('moderation_seed', '0')) >= seed.version) return;
  tx(() => {
    for (const [action, list] of [['review', seed.review], ['block', seed.block]] as const) {
      for (const term of list) {
        run('INSERT INTO blocked_terms (term, action) VALUES (?, ?) ON CONFLICT(term) DO UPDATE SET action = excluded.action', term, action);
      }
    }
    setSetting('moderation_seed', String(seed.version));
  });
  invalidateTerms();
}

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's' };

/** Lower-case and undo look-alike characters inside words that mix letters and symbols. */
function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\p{L}\p{N}@$]+/gu, (tok) => (/\p{L}/u.test(tok) && /[0-9@$]/.test(tok) ? tok.replace(/[0-9@$]/g, (c) => LEET[c] ?? c) : tok));
}

// Each letter may repeat ("pooorn"), and a space in a phrase matches any run of spaces.
const pattern = (term: string) => [...term].map((c) => (/\s/u.test(c) ? '\\s+' : /[\p{L}\p{N}]/u.test(c) ? `${c}+` : c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('');
let compiled: { block: RegExp | null; review: RegExp | null } | null = null;

export function invalidateTerms() {
  compiled = null;
}

function compile(): NonNullable<typeof compiled> {
  if (compiled) return compiled;
  const build = (action: TermAction) => {
    const terms = all('SELECT term FROM blocked_terms WHERE action = ?', action).map((r) => normalise(String(r.term))).filter(Boolean);
    if (!terms.length) return null;
    terms.sort((a, b) => b.length - a.length);
    return new RegExp(`(?<![\\p{L}\\p{N}])(?:${terms.map(pattern).join('|')})(?![\\p{L}\\p{N}])`, 'iu');
  };
  return (compiled = { block: build('block'), review: build('review') });
}

/** What, if anything, the text trips: a blocked term wins over a review term. */
export function screenText(text: string): { action: TermAction; term: string } | null {
  const t = normalise(text);
  const { block, review } = compile();
  const b = block?.exec(t);
  if (b) return { action: 'block', term: b[0] };
  const r = review?.exec(t);
  return r ? { action: 'review', term: r[0] } : null;
}

/** Throws 400 when any of the texts contains a blocked term; returns true when one needs review. */
export function screenFields(...texts: (string | null | undefined)[]): boolean {
  let needsReview = false;
  for (const t of texts) {
    if (!t) continue;
    const hit = screenText(t);
    if (hit?.action === 'block') throw new HttpError(400, "This contains language that isn't allowed on OmniBiz. Please change it and try again.");
    if (hit) needsReview = true;
  }
  return needsReview;
}

export function termCounts() {
  return get("SELECT SUM(action = 'block') AS block, SUM(action = 'review') AS review FROM blocked_terms") ?? { block: 0, review: 0 };
}
