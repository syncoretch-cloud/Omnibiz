/** Where the public OmniBiz app lives, for "open profile / open in context" links. Set VITE_APP_URL in production. */
const base = (import.meta.env.VITE_APP_URL as string | undefined) ?? 'http://localhost:5173';
export const appUrl = (path: string) => base.replace(/\/$/, '') + path;
