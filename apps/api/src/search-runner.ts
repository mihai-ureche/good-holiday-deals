import { db } from './db.js';
import { searchSchema } from '../../../packages/shared/src/index.js';
import { collect, providers, type TravelProvider } from '../../../packages/providers/src/index.js';
import { combineTrips } from '../../../packages/shared/src/combinations.js';

export class SearchRunError extends Error {
  constructor(message: string, public statusCode: number) { super(message); }
}

export async function runSearch(id: string, options: { userId?: string; manual?: boolean; adapters?: TravelProvider[] } = {}) {
  const client = await db.connect();
  let acquired = false;
  try {
    const found = await client.query(`SELECT criteria,last_checked_at FROM searches
      WHERE id=$1 AND ($2::uuid IS NULL OR user_id=$2)`, [id, options.userId ?? null]);
    if (!found.rowCount) throw new SearchRunError('Search not found', 404);
    const criteria = searchSchema.parse(found.rows[0].criteria);
    if (!criteria.active) throw new SearchRunError('Resume this search before running it', 409);
    if (criteria.latestReturn < new Date().toISOString().slice(0, 10)) throw new SearchRunError('This travel window has ended. Create a new search with future dates.', 400);
    if (options.manual && found.rows[0].last_checked_at && Date.now() - new Date(found.rows[0].last_checked_at).getTime() < 60_000) {
      throw new SearchRunError('This search was just checked. Wait a minute before searching again.', 429);
    }
    acquired = (await client.query('SELECT pg_try_advisory_lock(73862403) AS acquired')).rows[0].acquired;
    if (!acquired) throw new SearchRunError('Another search is running. Please try again shortly.', 409);
    const result = await collect(criteria, options.adapters);
    const combinations = combineTrips(criteria, result.offers, result.discoveries);
    const missingFlightSource = criteria.tripTypes.includes('flight')
      && !(options.adapters ?? providers).some(provider => provider.liveRoundTripFlights && provider.search);
    const status = (result.configured === 0 ? 'No quote providers configured for this search.'
      : `${result.offers.length} specific quotes; ${result.discoveries.length} promotions; ${combinations.length} flight + stay options.${result.failures.length ? ` Unavailable sources: ${result.failures.join(', ')}.` : ''}`)
      + (missingFlightSource ? ' Live round-trip flight pricing is not connected.' : '');
    await client.query('BEGIN');
    try {
      const exists = await client.query('SELECT id,criteria FROM searches WHERE id=$1 FOR UPDATE', [id]);
      if (!exists.rowCount) throw new SearchRunError('Search was deleted while running', 404);
      if (JSON.stringify(searchSchema.parse(exists.rows[0].criteria)) !== JSON.stringify(criteria)) {
        throw new SearchRunError('Search settings changed while running. Please search again.', 409);
      }
      await client.query('DELETE FROM offers WHERE search_id=$1', [id]);
      await client.query('DELETE FROM discoveries WHERE search_id=$1', [id]);
      for (const offer of result.offers) await client.query('INSERT INTO offers VALUES ($1,$2,$3,$4)',
        [id, offer.provider, offer.externalId, offer]);
      for (const lead of result.discoveries) await client.query('INSERT INTO discoveries VALUES ($1,$2,$3,$4)',
        [id, lead.provider, lead.externalId, lead]);
      await client.query('UPDATE searches SET last_checked_at=now(),last_status=$1 WHERE id=$2', [status, id]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    return { ...result, combinations, name: criteria.name, status };
  } finally {
    if (acquired) await client.query('SELECT pg_advisory_unlock(73862403)');
    client.release();
  }
}
