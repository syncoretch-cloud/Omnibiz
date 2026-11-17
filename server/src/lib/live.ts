// Live updates over Server-Sent Events: each signed-in browser keeps one open stream and is told when
// something arrives for it (a notification, a message), instead of asking again every few seconds.
import type { Response } from 'express';

const clients = new Map<number, Set<Response>>();

export function addLiveClient(userId: number, res: Response) {
  const set = clients.get(userId) ?? new Set();
  set.add(res);
  clients.set(userId, set);
  return () => {
    set.delete(res);
    if (!set.size) clients.delete(userId);
  };
}

export function isOnline(userId: number) {
  return clients.has(userId);
}

/** Sends one event to every open stream of each user. A dead connection is dropped on the next write. */
export function pushLive(userIds: number[], event: string, data: unknown = {}) {
  const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const id of new Set(userIds)) {
    for (const res of clients.get(id) ?? []) {
      try { res.write(frame); } catch { clients.get(id)?.delete(res); }
    }
  }
}

export function closeLiveClients() {
  for (const set of clients.values()) for (const res of set) res.end();
  clients.clear();
}
