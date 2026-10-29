import { z } from 'zod';
import { db, migrate } from './db.js';
import { hashToken, token } from './auth.js';
const email = z.email().parse(process.argv[2]).toLowerCase();
try {
  await migrate();
  const value = token();
  await db.query(`INSERT INTO invitations (token_hash,email,expires_at) VALUES ($1,$2,now()+interval '7 days')`,
    [hashToken(value), email]);
  console.log(`Invitation for ${email} (valid for 7 days; share privately):\n${value}`);
} finally { await db.end(); }
