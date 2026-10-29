import { db, migrate } from '../../api/src/db.js';
import { tick } from './jobs.js';
import { config } from '../../api/src/config.js';
if (config.EMAIL_MODE === 'graph' && [config.GRAPH_TENANT_ID, config.GRAPH_CLIENT_ID,
  config.GRAPH_CLIENT_SECRET, config.GRAPH_SENDER].some(v => !v)) {
  throw new Error('Microsoft Graph configuration is incomplete');
}
await migrate();
console.log(JSON.stringify({ event: 'worker_started', emailMode: config.EMAIL_MODE, timezone: config.DIGEST_TIMEZONE }));
let stopping = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let wake: (() => void) | undefined;
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { stopping = true; clearTimeout(timer); wake?.(); });
while (!stopping) {
  try {
    await tick();
    await db.query('DELETE FROM sessions WHERE expires_at<now()');
    await db.query('DELETE FROM invitations WHERE expires_at<now()');
  } catch { console.error(JSON.stringify({ event: 'worker_tick_failed' })); }
  if (!stopping) await new Promise<void>(resolve => { wake = resolve; timer = setTimeout(resolve, 60_000); });
}
await db.end();
