import fs from 'node:fs';
import path from 'node:path';
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

// OmniBiz Manager: the same API with the staff app on its own port, so it is reachable whenever the server is running.
let manager: ReturnType<typeof app.listen> | null = null;
if (config.managerPort && fs.existsSync(path.join(config.adminDist, 'index.html'))) {
  manager = createApp({ dist: config.adminDist }).listen(config.managerPort, () => {
    console.log(`OmniBiz Manager listening on http://localhost:${config.managerPort}`);
  });
  manager.on('error', (e) => console.error(`OmniBiz Manager could not start on port ${config.managerPort}: ${e.message}`));
}

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  // Logged so an unexpected stop (e.g. its console window being closed) is visible in server.log.
  console.log(`[${new Date().toISOString()}] received ${signal}, shutting down`);
  server.close();
  manager?.close();
  await settle();
  db.close();
  process.exit(0);
}
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'] as const) process.on(signal, () => shutdown(signal));
process.on('exit', (code) => console.log(`[${new Date().toISOString()}] process exiting with code ${code}`));
