// In-process event queue for background work (notifications, job matching, indexing, analytics).
// The interface — emit(event, payload) / on(event, handler) — is the seam where a durable broker
// (Redis Streams, RabbitMQ, Kafka, SQS) plugs in once workers run as separate services.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler = (payload: any) => void | Promise<void>;

const handlers = new Map<string, Handler[]>();
const pending: { event: string; payload: unknown; attempt: number }[] = [];
let draining: Promise<void> | null = null;

export function on(event: string, handler: Handler) {
  const list = handlers.get(event) ?? [];
  list.push(handler);
  handlers.set(event, list);
}

export function emit(event: string, payload: unknown) {
  pending.push({ event, payload, attempt: 0 });
  if (!draining) draining = new Promise((r) => setImmediate(r)).then(drainLoop);
}

async function drainLoop() {
  try {
    while (pending.length) {
      const job = pending.shift()!;
      for (const h of handlers.get(job.event) ?? []) {
        try {
          await h(job.payload);
        } catch (err) {
          console.error(`[queue] ${job.event} handler failed (attempt ${job.attempt + 1})`, err);
          if (job.attempt < 2) pending.push({ ...job, attempt: job.attempt + 1 });
        }
      }
    }
  } finally {
    draining = null;
  }
}

/** Waits until every queued event has been processed (used by tests and graceful shutdown). */
export async function settle() {
  while (draining || pending.length) {
    if (!draining && pending.length) draining = drainLoop();
    await draining;
  }
}
