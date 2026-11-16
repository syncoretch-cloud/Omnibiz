// Automatic first look at new posts. A match does not delete anything: the post is held ("flagged") and the author
// is told it is under review, so a moderator makes the call from the admin panel.
import { all, run, tx } from '../db/index.ts';

const DEFAULT_TERMS = ['porn', 'xxx', 'nude', 'nudes', 'nsfw', 'hentai', 'onlyfans', 'blowjob', 'sex tape', 'escort service'];

export function ensureBlockedTerms() {
  tx(() => DEFAULT_TERMS.forEach((t) => run('INSERT OR IGNORE INTO blocked_terms (term) VALUES (?)', t)));
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The first blocked term found in the text (whole words, any case), or null. */
export function screenText(text: string): string | null {
  const terms = all('SELECT term FROM blocked_terms').map((r) => r.term as string);
  for (const t of terms) {
    if (new RegExp(`(?<![\\p{L}\\p{N}])${escape(t)}(?![\\p{L}\\p{N}])`, 'iu').test(text)) return t;
  }
  return null;
}
