import { createApp } from './app.ts';
import { config } from './config.ts';
import { db } from './db/index.ts';
import { settle } from './lib/queue.ts';
import { startDemoStories } from './services/demoStories.ts';

const app = createApp();
const server = app.listen(config.port, () => {
  console.log(`OmniBiz API listening on http://localhost:${config.port} (${config.env})`);
});
startDemoStories();

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  // Logged so an unexpected stop (e.g. its console window being closed) is visible in server.log.
  console.log(`[${new Date().toISOString()}] received ${signal}, shutting down`);
  server.close();
  await settle();
  db.close();
  process.exit(0);
}
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'] as const) process.on(signal, () => shutdown(signal));
process.on('exit', (code) => console.log(`[${new Date().toISOString()}] process exiting with code ${code}`));
