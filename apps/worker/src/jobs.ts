import { db } from '../../api/src/db.js';
import { config } from '../../api/src/config.js';
import { localSchedule, type Offer, type Discovery } from '../../../packages/shared/src/index.js';
import { runSearch } from '../../api/src/search-runner.js';
import type { CombinedTrip } from '../../../packages/shared/src/combinations.js';
import { digestText, graphToken, sendDigest } from './email.js';

export async function tick(now = new Date()) {
  const schedule = localSchedule(now, config.DIGEST_TIMEZONE);
  if (!schedule.due) return;
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
        const sections: { name: string; offers: Offer[]; discoveries: Discovery[]; combinations: CombinedTrip[]; status: string }[] = [];
        for (const row of searches.rows) {
          const result = await runSearch(row.id);
          sections.push({ name: result.name, offers: result.offers, discoveries: result.discoveries, combinations: result.combinations, status: result.status });
        }
        if (config.EMAIL_MODE === 'disabled') {
          await db.query(`UPDATE digests SET status='collected',updated_at=now() WHERE user_id=$1 AND local_day=$2`, [user.id, schedule.day]);
          continue;
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
