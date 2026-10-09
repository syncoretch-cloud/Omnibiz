// Direct messaging between users and businesses (Customer → Retailer, Job seeker → Company,
// Retailer → Wholesaler…). Clients poll; a WebSocket/SSE gateway can push the same payloads later.
import { Router } from 'express';
import type { Request } from 'express';
import { all, get, parseJson, qs, run, tx, HOUR } from '../db/index.ts';
import { badRequest, HttpError, intParam, notFound, validate } from '../lib/http.ts';
import { requireAuth, requirePerm } from '../lib/auth.ts';
import { hit } from '../lib/ratelimit.ts';
import { isBusiness } from '../lib/constants.ts';
import { userCards } from '../services/users.ts';
import { track } from '../services/analytics.ts';

export const messagesRouter = Router();
messagesRouter.use(requireAuth);

function membership(req: Request) {
  const id = intParam(req);
  const m = get('SELECT * FROM conversation_members WHERE conversation_id = ? AND user_id = ?', id, req.user!.id);
  if (!m) throw notFound('Conversation');
  return { id, member: m };
}

function sendMessage(conversationId: number, senderId: number, body: string) {
  if (!hit(`msg:${senderId}`, 120, HOUR)) throw new HttpError(429, 'You are sending messages too quickly');
  return tx(() => {
    const { id } = run('INSERT INTO messages (conversation_id, sender_id, body) VALUES (?,?,?)', conversationId, senderId, body);
    run("UPDATE conversations SET last_message = ?, updated_at = datetime('now') WHERE id = ?", body.slice(0, 200), conversationId);
    run("UPDATE conversation_members SET last_read_at = datetime('now') WHERE conversation_id = ? AND user_id = ?", conversationId, senderId);
    return id;
  });
}

messagesRouter.get('/conversations', (req, res) => {
  const rows = all(
    `SELECT c.*, cm.last_read_at,
       (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id AND m.sender_id != ? AND m.created_at > cm.last_read_at) AS unread
     FROM conversations c JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = ?
     ORDER BY c.updated_at DESC LIMIT 100`,
    req.user!.id, req.user!.id,
  );
  const ids = rows.map((r) => r.id);
  const members = ids.length ? all(`SELECT conversation_id, user_id FROM conversation_members WHERE conversation_id IN (${qs(ids.length)}) AND user_id != ?`, ...ids, req.user!.id) : [];
  const cards = userCards(members.map((m) => m.user_id));
  res.json({
    conversations: rows.map((r) => ({
      id: r.id,
      context: parseJson(r.context, {}),
      last_message: r.last_message,
      updated_at: r.updated_at,
      unread: r.unread,
      participants: members.filter((m) => m.conversation_id === r.id).map((m) => cards.get(m.user_id)),
    })),
  });
});

/** Opens (or reuses) a 1:1 conversation, optionally about a product/job, and sends the first message. */
messagesRouter.post('/start', requirePerm('message'), (req, res) => {
  const d = validate(req.body, {
    user_id: { type: 'int', required: true, min: 1 },
    body: { type: 'text', max: 4000 },
    context: { type: 'json' },
  });
  if (d.user_id === req.user!.id) throw badRequest('You cannot message yourself');
  const other = get("SELECT id, account_type FROM users WHERE id = ? AND status = 'active'", d.user_id);
  if (!other) throw notFound('Account');
  const ctxIn = (d.context ?? {}) as Record<string, unknown>;
  const context: Record<string, unknown> = {};
  if (['product', 'job', 'order'].includes(String(ctxIn.type)) && Number.isInteger(ctxIn.id)) {
    context.type = ctxIn.type;
    context.id = ctxIn.id;
    context.title = String(ctxIn.title ?? '').slice(0, 120);
  }
  let conv = get(
    `SELECT c.id FROM conversations c
     JOIN conversation_members a ON a.conversation_id = c.id AND a.user_id = ?
     JOIN conversation_members b ON b.conversation_id = c.id AND b.user_id = ?
     WHERE (SELECT COUNT(*) FROM conversation_members x WHERE x.conversation_id = c.id) = 2 LIMIT 1`,
    req.user!.id, other.id,
  );
  const isNew = !conv;
  if (!conv) {
    conv = tx(() => {
      const { id } = run('INSERT INTO conversations (context) VALUES (?)', context);
      run('INSERT INTO conversation_members (conversation_id, user_id) VALUES (?,?)', id, req.user!.id);
      run('INSERT INTO conversation_members (conversation_id, user_id) VALUES (?,?)', id, other.id);
      return { id };
    });
  } else if (context.type) run('UPDATE conversations SET context = ? WHERE id = ?', context, conv.id);
  if (d.body) sendMessage(conv.id, req.user!.id, d.body);
  if (isNew && isBusiness(other.account_type)) {
    track({ ownerId: other.id, actorId: req.user!.id, type: 'inquiry', targetType: (context.type as string) ?? null, targetId: (context.id as number) ?? null });
  }
  res.status(isNew ? 201 : 200).json({ conversation_id: conv.id });
});

messagesRouter.get('/conversations/:id/messages', (req, res) => {
  const { id } = membership(req);
  const after = Number(req.query.after) || 0;
  const before = Number(req.query.before) || 0;
  const rows = after
    ? all('SELECT * FROM messages WHERE conversation_id = ? AND id > ? ORDER BY id ASC LIMIT 200', id, after)
    : all(`SELECT * FROM messages WHERE conversation_id = ? ${before ? 'AND id < ?' : ''} ORDER BY id DESC LIMIT 50`, id, ...(before ? [before] : [])).reverse();
  run("UPDATE conversation_members SET last_read_at = datetime('now') WHERE conversation_id = ? AND user_id = ?", id, req.user!.id);
  const memberIds = all('SELECT user_id FROM conversation_members WHERE conversation_id = ?', id).map((r) => r.user_id);
  const conv = get('SELECT * FROM conversations WHERE id = ?', id)!;
  const cards = userCards(memberIds);
  res.json({
    conversation: { id, context: parseJson(conv.context, {}), participants: memberIds.filter((m) => m !== req.user!.id).map((m) => cards.get(m)) },
    messages: rows.map((m) => ({ id: m.id, body: m.body, created_at: m.created_at, sender_id: m.sender_id, mine: m.sender_id === req.user!.id })),
  });
});

messagesRouter.post('/conversations/:id/messages', requirePerm('message'), (req, res) => {
  const { id } = membership(req);
  const { body } = validate(req.body, { body: { type: 'text', required: true, max: 4000 } });
  const mid = sendMessage(id, req.user!.id, body);
  const m = get('SELECT * FROM messages WHERE id = ?', mid)!;
  res.status(201).json({ message: { id: m.id, body: m.body, created_at: m.created_at, sender_id: m.sender_id, mine: true } });
});
