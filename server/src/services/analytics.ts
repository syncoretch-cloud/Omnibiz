import { run, tx } from '../db/index.ts';

export interface AnalyticsEvent {
  ownerId: number;
  actorId?: number | null;
  type: string; // profile_view | product_view | job_view | post_impression | search_appearance | inquiry | application | follow
  targetType?: string | null;
  targetId?: number | null;
  source?: string | null;
}

/** Records business-facing analytics. Owners viewing their own content are not counted. */
export function track(events: AnalyticsEvent | AnalyticsEvent[]) {
  const list = (Array.isArray(events) ? events : [events]).filter((e) => e.ownerId && e.ownerId !== e.actorId);
  if (!list.length) return;
  tx(() => {
    for (const e of list) {
      run(
        'INSERT INTO analytics_events (owner_id, actor_id, type, target_type, target_id, source) VALUES (?,?,?,?,?,?)',
        e.ownerId, e.actorId ?? null, e.type, e.targetType ?? null, e.targetId ?? null, e.source?.slice(0, 50) ?? null,
      );
    }
  });
}
