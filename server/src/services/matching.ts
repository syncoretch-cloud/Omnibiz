// Job ↔ candidate matching (spec §12, §32 "AI job matching" / "CV analysis").
// Deterministic and explainable: every score comes with the reasons behind it, so the same
// output can later be blended with (or replaced by) a learned/LLM ranker without changing callers.
import { all, parseJson, qs } from '../db/index.ts';
import type { Row } from '../db/index.ts';
import { EDUCATION_LEVELS } from '../lib/constants.ts';
import { cityCoords, distanceKm } from '../lib/geo.ts';

export interface Candidate {
  userId: number;
  city: string | null;
  skills: string[];
  skillLabels: string[];
  text: string;
  eduLevel: number;
  eduPrograms: string[];
  years: number;
  prefLocations: string[];
  prefIndustries: string[];
  interests: string[];
  jobTypes: string[];
}

export interface MatchResult {
  score: number;
  matchedSkills: string[];
  partialSkills: string[];
  missingSkills: string[];
  strengths: string[];
  gaps: string[];
  breakdown: { skills: number; education: number; experience: number; location: number; industry: number; jobType: number };
}

const SYNONYMS: Record<string, string> = {
  js: 'javascript', reactjs: 'react', 'react.js': 'react', nodejs: 'node', 'node.js': 'node', ts: 'typescript',
  postgres: 'postgresql', 'ms excel': 'excel', 'microsoft excel': 'excel', ml: 'machine learning', 'c sharp': 'c#',
  py: 'python', vuejs: 'vue', 'vue.js': 'vue', k8s: 'kubernetes', 'ui/ux': 'ux', 'ux design': 'ux',
};

export function normSkill(s: string): string {
  const t = s.toLowerCase().trim().replace(/\s+/g, ' ');
  return SYNONYMS[t] ?? t.replace(/\.js$/, '');
}

const eduRank = (level?: string | null) => Math.max(0, EDUCATION_LEVELS.indexOf((level ?? 'none') as (typeof EDUCATION_LEVELS)[number]));

function monthsBetween(start?: string, end?: string | null): number {
  const s = start ? Date.parse(start.length === 7 ? start + '-01' : start) : NaN;
  if (Number.isNaN(s)) return 0;
  const e = end ? Date.parse(end.length === 7 ? end + '-01' : end) : Date.now();
  return Math.max(0, ((Number.isNaN(e) ? Date.now() : e) - s) / (30.44 * 86_400_000));
}

/** Loads matching profiles for the given users (or every open-to-work personal user when omitted). */
export function loadCandidates(userIds?: number[]): Candidate[] {
  const base = userIds?.length
    ? all(`SELECT u.id, u.city FROM users u WHERE u.id IN (${qs(userIds.length)}) AND u.account_type = 'personal'`, ...userIds)
    : all(`SELECT u.id, u.city FROM users u JOIN profiles p ON p.user_id = u.id
           WHERE u.account_type = 'personal' AND u.status = 'active' AND p.open_to_work = 1`);
  if (!base.length) return [];
  const ids = base.map((r) => r.id as number);
  const list = qs(ids.length);
  const profiles = new Map(all(`SELECT * FROM profiles WHERE user_id IN (${list})`, ...ids).map((r) => [r.user_id, r]));
  const items = all(`SELECT user_id, section, data FROM cv_items WHERE user_id IN (${list})`, ...ids);
  const interests = all(`SELECT user_id, slug FROM user_interests WHERE user_id IN (${list})`, ...ids);

  const byUser = new Map<number, Candidate>();
  for (const r of base) {
    const p = profiles.get(r.id);
    byUser.set(r.id, {
      userId: r.id,
      city: r.city,
      skills: [],
      skillLabels: [],
      text: [p?.headline, p?.summary].filter(Boolean).join(' ').toLowerCase(),
      eduLevel: 0,
      eduPrograms: [],
      years: 0,
      prefLocations: parseJson<string[]>(p?.preferred_locations, []).map((s) => s.toLowerCase()),
      prefIndustries: parseJson<string[]>(p?.preferred_industries, []),
      interests: [],
      jobTypes: parseJson<string[]>(p?.job_types, []),
    });
  }
  for (const it of items) {
    const c = byUser.get(it.user_id);
    if (!c) continue;
    const d = parseJson<Row>(it.data, {});
    if (it.section === 'skill' && d.name) {
      c.skills.push(normSkill(d.name));
      c.skillLabels.push(d.name);
    } else if (it.section === 'education') {
      c.eduLevel = Math.max(c.eduLevel, eduRank(d.level));
      if (d.program) c.eduPrograms.push(String(d.program).toLowerCase());
    } else if (it.section === 'experience') {
      c.years += monthsBetween(d.start_date, d.current ? null : d.end_date) / 12;
      c.text += ` ${d.position ?? ''} ${d.responsibilities ?? ''}`.toLowerCase();
    } else if (it.section === 'portfolio' || it.section === 'certification') {
      c.text += ` ${d.title ?? d.name ?? ''} ${d.description ?? ''}`.toLowerCase();
    }
  }
  for (const r of interests) byUser.get(r.user_id)?.interests.push(r.slug);
  return [...byUser.values()];
}

export function scoreMatch(job: Row, c: Candidate): MatchResult {
  const required = parseJson<string[]>(job.skills, []);
  const strengths: string[] = [];
  const gaps: string[] = [];

  // Skills — 45 points
  const have = new Set(c.skills);
  const matchedSkills: string[] = [];
  const partialSkills: string[] = [];
  const missingSkills: string[] = [];
  for (const s of required) {
    const n = normSkill(s);
    if (have.has(n)) matchedSkills.push(s);
    else if (n.length >= 3 && new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(c.text)) partialSkills.push(s);
    else missingSkills.push(s);
  }
  const skills = required.length ? Math.round((45 * (matchedSkills.length + 0.5 * partialSkills.length)) / required.length) : 30;
  if (required.length) {
    if (matchedSkills.length) strengths.push(`You list ${matchedSkills.length} of ${required.length} required skills`);
    if (partialSkills.length) strengths.push(`Your experience mentions ${partialSkills.join(', ')}`);
    if (missingSkills.length) gaps.push(`Not on your profile: ${missingSkills.join(', ')}`);
  }

  // Education — 15 points
  const reqLevel = eduRank(job.education_req);
  const field = (job.education_field ?? '').toLowerCase().trim();
  const fieldMatch = !field || c.eduPrograms.some((p) => p.includes(field) || field.includes(p));
  let education = 0;
  if (c.eduLevel >= reqLevel) education = fieldMatch ? 15 : 10;
  else if (c.eduLevel === reqLevel - 1) education = 6;
  if (reqLevel > 0) {
    if (c.eduLevel >= reqLevel) strengths.push(`Meets the ${job.education_req} education requirement`);
    else gaps.push(`Requires ${job.education_req} level education`);
    if (field && !fieldMatch) gaps.push(`Preferred field of study: ${job.education_field}`);
  }

  // Experience — 15 points
  const reqYears = Number(job.experience_years) || 0;
  const experience = reqYears ? Math.round(15 * Math.min(1, c.years / reqYears)) : 15;
  if (reqYears) {
    if (c.years >= reqYears) strengths.push(`${Math.floor(c.years)}+ years of experience (needs ${reqYears})`);
    else gaps.push(`Needs ${reqYears} years of experience; your profile shows ${c.years.toFixed(1)}`);
  }

  // Location — 15 points
  let location = 0;
  const jobCity = (job.city ?? '').toLowerCase();
  if (job.remote) {
    location = 15;
    strengths.push('Remote-friendly role');
  } else if (jobCity && ((c.city ?? '').toLowerCase() === jobCity || c.prefLocations.includes(jobCity))) {
    location = 15;
    strengths.push(`Located in or prefers ${job.city}`);
  } else {
    const a = cityCoords(c.city);
    const b = job.lat != null ? { lat: job.lat, lng: job.lng } : cityCoords(job.city);
    if (a && b) {
      const d = distanceKm(a, b);
      location = d < 60 ? 12 : d < 200 ? 6 : 0;
      if (d >= 200) gaps.push(`Role is in ${job.city}, about ${Math.round(d)} km away`);
    }
  }

  // Industry / interests — 10 points
  const industry = job.industry && (c.prefIndustries.includes(job.industry) || c.interests.includes(job.industry)) ? 10 : 0;
  if (industry) strengths.push('Matches your preferred industries');

  // Job type preference — penalty only
  const jobType = c.jobTypes.length && !c.jobTypes.includes(job.employment_type) ? -10 : 0;
  if (jobType) gaps.push(`You prefer ${c.jobTypes.join('/').replace(/_/g, ' ')} roles`);

  const score = Math.max(0, Math.min(100, skills + education + experience + location + industry + jobType));
  return { score, matchedSkills, partialSkills, missingSkills, strengths, gaps, breakdown: { skills, education, experience, location, industry, jobType } };
}

export function matchFor(job: Row, userId: number): MatchResult | null {
  const [c] = loadCandidates([userId]);
  return c ? scoreMatch(job, c) : null;
}
