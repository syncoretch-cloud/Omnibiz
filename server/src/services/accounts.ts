import { get, run, tx } from '../db/index.ts';
import { reindexUser } from './search-index.ts';

/** Removes an account from the platform: it can't sign in, its name is cleared, and its posts, products and jobs come down. */
export function deleteAccount(userId: number) {
  const user = get('SELECT * FROM users WHERE id = ?', userId);
  if (!user) return;
  tx(() => {
    run("UPDATE users SET status = 'deleted', email = ?, username = ?, phone = NULL, display_name = 'Deleted account', avatar_url = NULL, bio = NULL, verified = 0 WHERE id = ?",
      `deleted-${user.id}@omnibiz.invalid`, `deleted_${user.id}`, user.id);
    run('DELETE FROM sessions WHERE user_id = ?', user.id);
    run("UPDATE posts SET status = 'removed' WHERE author_id = ?", user.id);
    run("UPDATE products SET status = 'archived' WHERE seller_id = ?", user.id);
    run("UPDATE jobs SET status = 'closed' WHERE company_id = ?", user.id);
    run("UPDATE subscriptions SET status = 'cancelled', ended_at = datetime('now') WHERE user_id = ? AND status = 'active'", user.id);
  });
  reindexUser(user.id);
}
