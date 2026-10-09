import { run, tx } from '../db/index.ts';

export interface NotificationInput {
  type: string;
  title: string;
  body?: string | null;
  link?: string | null;
  actorId?: number | null;
}

/** Creates in-app notifications. The actor never notifies themselves. Returns the number delivered. */
export function notify(userIds: number[], n: NotificationInput): number {
  const ids = [...new Set(userIds)].filter((id) => id && id !== n.actorId);
  if (!ids.length) return 0;
  tx(() => {
    for (const id of ids) {
      run(
        'INSERT INTO notifications (user_id, type, title, body, link, actor_id) VALUES (?,?,?,?,?,?)',
        id, n.type, n.title.slice(0, 200), n.body?.slice(0, 500) ?? null, n.link ?? null, n.actorId ?? null,
      );
    }
  });
  return ids.length;
}
