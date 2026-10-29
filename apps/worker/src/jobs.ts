import { db } from '../../api/src/db.js';
import { config } from '../../api/src/config.js';
import { searchSchema, localSchedule, type Offer } from '../../../packages/shared/src/index.js';
import { collect } from '../../../packages/providers/src/index.js';
import { digestText, graphToken, sendDigest } from './email.js';

export async function tick(now = new Date()) {
  const schedule = localSchedule(now, config.DIGEST_TIMEZONE);
  if (!schedule.due || config.EMAIL_MODE === 'disabled') return;
  const lock = await db.connect();
  try {
    const acquired = await lock.query('SELECT pg_try_advisory_lock(73862402) AS acquired');
    if (!acquired.rows[0]?.acquired) return;
    const users = await db.query(`SELECT id,email FROM users u WHERE digest_enabled=true
      AND EXISTS (SELECT 1 FROM searches s WHERE s.user_id=u.id AND (s.criteria->>'active')::boolean=true
      AND (s.criteria->>'latestReturn')::date >= $1::date) ORDER BY created_at`, [schedule.day]);
    for (const user of users.rows) {
      const claimed = await db.query(`INSERT INTO digests (user_id,local_day,status) VALUES ($1,$2,'building')
        ON CONFLICT (user_id,local_day) DO UPDATE SET status='building',attempts=digests.attempts+1,updated_at=now(),error=NULL
        WHERE digests.status IN ('build_failed','building') AND digests.attempts<3
        AND digests.updated_at<now()-interval '5 minutes' RETURNING user_id`, [user.id, schedule.day]);
      if (!claimed.rowCount) continue;
      let sending = false;
      try {
        const searches = await db.query(`SELECT id,criteria FROM searches WHERE user_id=$1
          AND (criteria->>'active')::boolean=true AND (criteria->>'latestReturn')::date >= $2::date`, [user.id, schedule.day]);
        const sections: { name: string; offers: Offer[]; status: string }[] = [];
        for (const row of searches.rows) {
          const criteria = searchSchema.parse(row.criteria);
          const result = await collect(criteria);
          const status = result.configured === 0 ? 'No live providers configured yet.'
            : `${result.offers.length} matching offers.${result.failures.length ? ` Unavailable sources: ${result.failures.join(', ')}.` : ''}`;
          // Replace each search snapshot atomically: a failed source cannot leave old quotes presented as fresh.
          const client = await db.connect();
          try {
            await client.query('BEGIN');
            await client.query('DELETE FROM offers WHERE search_id=$1', [row.id]);
            for (const offer of result.offers) await client.query('INSERT INTO offers VALUES ($1,$2,$3,$4)',
              [row.id, offer.provider, offer.externalId, offer]);
            await client.query('UPDATE searches SET last_checked_at=now(),last_status=$1 WHERE id=$2', [status, row.id]);
            await client.query('COMMIT');
          } catch (e) { await client.query('ROLLBACK'); throw e; }
          finally { client.release(); }
          sections.push({ name: criteria.name, offers: result.offers, status });
        }
        // Check preferences again after collection; users may have paused their daily email.
        const enabled = await db.query('SELECT digest_enabled FROM users WHERE id=$1', [user.id]);
        if (!enabled.rows[0]?.digest_enabled) {
          await db.query(`UPDATE digests SET status='cancelled',updated_at=now() WHERE user_id=$1 AND local_day=$2`, [user.id, schedule.day]);
          continue;
        }
        const accessToken = await graphToken();
        await db.query(`UPDATE digests SET status='sending',updated_at=now() WHERE user_id=$1 AND local_day=$2`, [user.id, schedule.day]);
        sending = true;
        await sendDigest(accessToken, user.email, digestText(sections, config.APP_URL));
        await db.query(`UPDATE digests SET status='accepted',updated_at=now() WHERE user_id=$1 AND local_day=$2`, [user.id, schedule.day]);
        console.log(JSON.stringify({ event: 'digest_accepted', userId: user.id, day: schedule.day }));
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unexpected worker failure';
        await db.query('UPDATE digests SET status=$1,error=$2,updated_at=now() WHERE user_id=$3 AND local_day=$4',
          [sending ? 'uncertain' : 'build_failed', message.slice(0, 300), user.id, schedule.day]);
        console.error(JSON.stringify({ event: 'digest_failed', userId: user.id, day: schedule.day,
          status: sending ? 'uncertain' : 'build_failed' }));
      }
    }
  } finally {
    await lock.query('SELECT pg_advisory_unlock(73862402)');
    lock.release();
  }
}
