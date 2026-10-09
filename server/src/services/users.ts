import { all, get, qs } from '../db/index.ts';
import type { Row } from '../db/index.ts';

const CARD_SQL = `SELECT u.id, u.username, u.display_name, u.avatar_url, u.account_type, u.city, u.country, u.role,
  b.verified, b.category, b.kind AS business_kind, p.headline
  FROM users u LEFT JOIN businesses b ON b.user_id = u.id LEFT JOIN profiles p ON p.user_id = u.id`;

export interface UserCard {
  id: number;
  username: string;
  display_name: string;
  avatar_url: string | null;
  account_type: string;
  city: string | null;
  verified: boolean;
  category: string | null;
  headline: string | null;
  is_staff: boolean;
}

function toCard(r: Row): UserCard {
  return {
    id: r.id,
    username: r.username,
    display_name: r.display_name,
    avatar_url: r.avatar_url,
    account_type: r.account_type,
    city: r.city,
    verified: !!r.verified,
    category: r.category ?? null,
    headline: r.headline ?? null,
    is_staff: r.role !== 'user',
  };
}

/** Batch-loads compact user cards for hydrating lists (posts, comments, jobs, products...). */
export function userCards(ids: (number | null | undefined)[]): Map<number, UserCard> {
  const uniq = [...new Set(ids.filter((x): x is number => typeof x === 'number'))];
  if (!uniq.length) return new Map();
  const rows = all(`${CARD_SQL} WHERE u.id IN (${qs(uniq.length)})`, ...uniq);
  return new Map(rows.map((r) => [r.id as number, toCard(r)]));
}

/** Which of `ids` the viewer follows. */
export function followingSet(viewerId: number | undefined, ids: number[]): Set<number> {
  if (!viewerId || !ids.length) return new Set();
  return new Set(all(`SELECT followee_id FROM follows WHERE follower_id = ? AND followee_id IN (${qs(ids.length)})`, viewerId, ...ids).map((r) => r.followee_id as number));
}

export function userCard(id: number): UserCard | null {
  const r = get(`${CARD_SQL} WHERE u.id = ?`, id);
  return r ? toCard(r) : null;
}

/** The signed-in user's own record, without secrets. */
export function selfView(u: Row) {
  return {
    id: u.id,
    account_type: u.account_type,
    username: u.username,
    email: u.email,
    phone: u.phone,
    display_name: u.display_name,
    avatar_url: u.avatar_url,
    cover_url: u.cover_url,
    bio: u.bio,
    country: u.country,
    region: u.region,
    city: u.city,
    lat: u.lat,
    lng: u.lng,
    share_precise_location: !!u.share_precise_location,
    email_verified: !!u.email_verified,
    phone_verified: !!u.phone_verified,
    totp_enabled: !!u.totp_enabled,
    role: u.role,
    status: u.status,
    suspended_reason: u.suspended_reason,
    onboarded: !!u.onboarded,
    created_at: u.created_at,
  };
}
