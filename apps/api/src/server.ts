import { createApp } from './app.js';
import { db, migrate } from './db.js';
import { config } from './config.js';
await migrate();
const app = await createApp();
await app.listen({ port: config.PORT, host: '0.0.0.0' });
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, async () => {
  await app.close();
  await db.end();
});
