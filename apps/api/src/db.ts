import pg from 'pg';
import { config } from './config.js';

export const db = new pg.Pool({ connectionString: config.DATABASE_URL, max: 4,
  connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000 });

export async function migrate() {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(73862401)');
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id uuid PRIMARY KEY, email text NOT NULL UNIQUE, password_hash text NOT NULL,
        digest_enabled boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS invitations (
        token_hash text PRIMARY KEY, email text NOT NULL, expires_at timestamptz NOT NULL,
        used_at timestamptz
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at timestamptz NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
      CREATE TABLE IF NOT EXISTS searches (
        id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        criteria jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
        last_checked_at timestamptz, last_status text
      );
      CREATE INDEX IF NOT EXISTS searches_user ON searches(user_id);
      CREATE TABLE IF NOT EXISTS offers (
        search_id uuid NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
        provider text NOT NULL, external_id text NOT NULL, payload jsonb NOT NULL,
        PRIMARY KEY (search_id, provider, external_id)
      );
      CREATE TABLE IF NOT EXISTS digests (
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        local_day date NOT NULL, status text NOT NULL, attempts integer NOT NULL DEFAULT 1,
        updated_at timestamptz NOT NULL DEFAULT now(), error text,
        PRIMARY KEY (user_id, local_day)
      );
    `);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally { client.release(); }
}
