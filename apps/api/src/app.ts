import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import serveStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z, ZodError } from 'zod';
import { db } from './db.js';
import { config } from './config.js';
import { hashPassword, hashToken, token, verifyPassword } from './auth.js';
import { searchObjectSchema, searchSchema } from '../../../packages/shared/src/index.js';
import { destinationCities, duffelDestinationAirports, ignavDestinationAirports, providers, sabreDestinationAirports, sourceCatalog } from '../../../packages/providers/src/index.js';
import { countryCode } from '../../../packages/shared/src/destinations.js';
import { runSearch } from './search-runner.js';
import { combineTrips } from '../../../packages/shared/src/combinations.js';
import { offerSchema, specificOffers } from '../../../packages/shared/src/index.js';
import { isAllowedOrigin } from './origin.js';

declare module 'fastify' { interface FastifyRequest { userId: string | null } }
const credentials = z.object({ email: z.email().max(254).transform(v => v.toLowerCase()),
  password: z.string().min(12).max(128) });
const authLimit = { rateLimit: { max: 8, timeWindow: '15 minutes' } };

export async function createApp() {
  const app = Fastify({ logger: config.NODE_ENV !== 'test', bodyLimit: 16 * 1024,
    // Only the local Compose reverse proxy is trusted for forwarded client addresses.
    trustProxy: ['127.0.0.1', '::1', '172.30.83.2'] });
  await app.register(cookie);
  await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });
  app.decorateRequest('userId', null);

  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/')) return;
    reply.header('Cache-Control', 'no-store');
    if (!['GET', 'HEAD'].includes(request.method)) {
      if (!isAllowedOrigin(request.headers.origin, config.APP_URL, config.NODE_ENV)) {
        return reply.code(403).send({ error: 'Request origin is not allowed' });
      }
      if (!request.headers['content-type']?.startsWith('application/json')) {
        return reply.code(415).send({ error: 'Expected JSON' });
      }
    }
    if (request.url.split('?')[0] === '/api/health' || request.url.startsWith('/api/auth/')) return;
    const value = request.cookies.session;
    if (value && value.length <= 128) {
      const result = await db.query('SELECT user_id FROM sessions WHERE token_hash=$1 AND expires_at>now()', [hashToken(value)]);
      request.userId = result.rows[0]?.user_id ?? null;
    }
    if (!request.userId) return reply.code(401).send({ error: 'Please sign in' });
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ error: error.issues.map(i => i.message).join('; ') });
    const status = error && typeof error === 'object' && 'statusCode' in error && typeof error.statusCode === 'number'
      ? error.statusCode : 500;
    if (status >= 500) request.log.error({ err: error }, 'Request failed');
    return reply.code(status).send({ error: status >= 500 ? 'Something went wrong. Please try again.'
      : error instanceof Error ? error.message : 'Request failed' });
  });
  app.get('/api/health', async () => { await db.query('SELECT 1'); return { ok: true }; });

  async function session(reply: import('fastify').FastifyReply, userId: string) {
    const value = token();
    await db.query(`INSERT INTO sessions VALUES ($1,$2,now()+interval '14 days')`, [hashToken(value), userId]);
    reply.setCookie('session', value, { path: '/', httpOnly: true, sameSite: 'strict',
      secure: config.NODE_ENV === 'production', maxAge: 14 * 86400 });
  }
  app.post('/api/auth/register', { config: authLimit }, async (request, reply) => {
    const data = credentials.extend({ invitation: z.string().regex(/^[a-f0-9]{64}$/) }).parse(request.body);
    const passwordHash = await hashPassword(data.password);
    const client = await db.connect();
    const id = randomUUID();
    try {
      await client.query('BEGIN');
      const invite = await client.query(`UPDATE invitations SET used_at=now()
        WHERE token_hash=$1 AND email=$2 AND expires_at>now() AND used_at IS NULL RETURNING email`,
      [hashToken(data.invitation), data.email]);
      if (!invite.rowCount) {
        await client.query('ROLLBACK');
        return reply.code(400).send({ error: 'Invitation is invalid, expired, or belongs to another email' });
      }
      await client.query('INSERT INTO users (id,email,password_hash) VALUES ($1,$2,$3)', [id, data.email, passwordHash]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      if ((e as { code?: string }).code === '23505') return reply.code(400).send({ error: 'Account already exists; sign in' });
      throw e;
    } finally { client.release(); }
    await session(reply, id);
    return { ok: true };
  });
  app.post('/api/auth/login', { config: authLimit }, async (request, reply) => {
    const data = credentials.parse(request.body);
    const result = await db.query('SELECT id,password_hash FROM users WHERE email=$1', [data.email]);
    const user = result.rows[0];
    // Spend scrypt work for unknown accounts as well.
    const valid = await verifyPassword(data.password, user?.password_hash ?? `${'0'.repeat(32)}:${'0'.repeat(128)}`);
    if (!user || !valid) return reply.code(401).send({ error: 'Email or password is incorrect' });
    await session(reply, user.id);
    return { ok: true };
  });
  app.post('/api/logout', async (request, reply) => {
    await db.query('DELETE FROM sessions WHERE token_hash=$1', [hashToken(request.cookies.session ?? '')]);
    reply.clearCookie('session', { path: '/' });
    return { ok: true };
  });
  app.get('/api/me', async request => {
    const result = await db.query('SELECT email,digest_enabled AS "digestEnabled" FROM users WHERE id=$1', [request.userId]);
    const liveFlightPricing = providers.some(provider => provider.liveRoundTripFlights && provider.search);
    const liveStayPricing = providers.some(provider => provider.liveStays && provider.search);
    return { ...result.rows[0], timezone: config.DIGEST_TIMEZONE, emailConfigured: config.EMAIL_MODE === 'graph',
      providers: providers.map(p => p.id), sources: sourceCatalog.map(source => {
        const provider = providers.find(value => value.id === source.id);
        if (provider?.liveRoundTripFlights && provider.liveStays) return { ...source, mode: 'live-flights-stays', detail: 'Live flight and accommodation search is connected.' };
        if (provider?.liveRoundTripFlights) return { ...source, mode: 'live-flights', detail: 'Live party-priced round-trip search is connected.' };
        return source;
      }), liveFlightPricing, liveStayPricing };
  });
  app.get<{ Querystring: { country?: string } }>('/api/destinations/cities', async request => {
    const country = z.string().trim().length(2).transform(value => value.toUpperCase())
      .refine(value => countryCode(value) === value, 'Choose a valid destination country')
      .parse(request.query.country);
    return { cities: await destinationCities(country) };
  });
  app.get<{ Querystring: { country?: string } }>('/api/destinations/airports', async (request, reply) => {
    const country = z.string().trim().length(2).transform(value => value.toUpperCase())
      .refine(value => countryCode(value) === value, 'Choose a valid destination country')
      .parse(request.query.country);
    if (process.env.IGNAV_API_KEY) {
      try { return { airports: await ignavDestinationAirports(country, process.env.IGNAV_API_KEY) }; }
      catch (error) { if (!process.env.DUFFEL_ACCESS_TOKEN && !(process.env.SABRE_USER_ID && process.env.SABRE_PASSWORD)) throw error; }
    }
    if (process.env.DUFFEL_ACCESS_TOKEN) {
      try { return { airports: await duffelDestinationAirports(country, process.env.DUFFEL_ACCESS_TOKEN) }; }
      catch (error) { if (!(process.env.SABRE_USER_ID && process.env.SABRE_PASSWORD)) throw error; }
    }
    if (process.env.SABRE_USER_ID && process.env.SABRE_PASSWORD) return { airports: await sabreDestinationAirports(country, {
      userId: process.env.SABRE_USER_ID, password: process.env.SABRE_PASSWORD,
      environment: process.env.SABRE_ENVIRONMENT === 'production' ? 'production' : 'cert' }) };
    return reply.code(503).send({ error: 'Add Ignav, Duffel, or Sabre credentials to load destination airports' });
  });
  app.patch('/api/me', async request => {
    const body = z.object({ digestEnabled: z.boolean() }).parse(request.body);
    await db.query('UPDATE users SET digest_enabled=$1 WHERE id=$2', [body.digestEnabled, request.userId]);
    return { ok: true };
  });
  app.get('/api/searches', async request => {
    const result = await db.query(`SELECT id,criteria,created_at AS "createdAt",last_checked_at AS "lastCheckedAt",
      last_status AS "lastStatus" FROM searches WHERE user_id=$1 ORDER BY created_at DESC`, [request.userId]);
    return result.rows.map(row => {
      const parsed = searchSchema.safeParse(row.criteria);
      return { ...(parsed.success ? parsed.data : row.criteria), id: row.id, createdAt: row.createdAt,
        lastCheckedAt: row.lastCheckedAt, lastStatus: row.lastStatus };
    });
  });
  app.post('/api/searches', async (request, reply) => {
    const criteria = searchSchema.parse(request.body);
    const result = await db.query(`INSERT INTO searches (id,user_id,criteria)
      SELECT $1,$2,$3 WHERE (SELECT count(*) FROM searches WHERE user_id=$2)<10 RETURNING id`,
    [randomUUID(), request.userId, criteria]);
    if (!result.rowCount) return reply.code(400).send({ error: 'You can save up to 10 searches' });
    return reply.code(201).send({ id: result.rows[0].id });
  });
  app.patch<{ Params: { id: string } }>('/api/searches/:id', async (request, reply) => {
    const id = z.uuid().parse(request.params.id);
    const body = z.partialRecord(searchObjectSchema.keyof(), z.unknown())
      .refine(v => Object.keys(v).length > 0, 'Provide a search setting to update').parse(request.body);
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query('SELECT criteria FROM searches WHERE id=$1 AND user_id=$2 FOR UPDATE', [id, request.userId]);
      if (!result.rowCount) { await client.query('ROLLBACK'); return reply.code(404).send({ error: 'Search not found' }); }
      const previousResult = searchSchema.safeParse(result.rows[0].criteria);
      const criteria = searchSchema.parse({ ...result.rows[0].criteria, ...body });
      const previous = previousResult.success ? previousResult.data : criteria;
      const { name: previousName, active: previousActive, ...previousFilters } = previous;
      const { name, active, ...filters } = criteria;
      const changed = !previousResult.success || JSON.stringify(filters) !== JSON.stringify(previousFilters);
      await client.query(`UPDATE searches SET criteria=$1,
        last_checked_at=CASE WHEN $2 THEN NULL ELSE last_checked_at END,
        last_status=CASE WHEN $2 THEN NULL ELSE last_status END WHERE id=$3`, [criteria, changed, id]);
      if (changed) {
        await client.query('DELETE FROM offers WHERE search_id=$1', [id]);
        await client.query('DELETE FROM discoveries WHERE search_id=$1', [id]);
      }
      await client.query('COMMIT');
      return { ok: true };
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  });
  app.delete<{ Params: { id: string } }>('/api/searches/:id', async (request, reply) => {
    const result = await db.query('DELETE FROM searches WHERE id=$1 AND user_id=$2', [z.uuid().parse(request.params.id), request.userId]);
    if (!result.rowCount) return reply.code(404).send({ error: 'Search not found' });
    return { ok: true };
  });
  app.post<{ Params: { id: string } }>('/api/searches/:id/run', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async request => {
    const result = await runSearch(z.uuid().parse(request.params.id), { userId: request.userId!, manual: true });
    return { offers: result.offers.length, discoveries: result.discoveries.length, combinations: result.combinations.length, status: result.status, failures: result.failures };
  });
  app.get('/api/trips', async request => {
    const result = await db.query(`SELECT s.id,s.criteria,
      COALESCE((SELECT jsonb_agg(payload) FROM offers WHERE search_id=s.id), '[]'::jsonb) AS quotes
      FROM searches s WHERE s.user_id=$1 AND (s.criteria->>'active')::boolean=true
      AND (s.criteria->>'latestReturn')::date>=current_date`, [request.userId]);
    return result.rows.flatMap(row => combineTrips(searchSchema.parse(row.criteria),
      row.quotes.map((value: unknown) => offerSchema.parse(value)))
      .map(trip => ({ ...trip, searchId: row.id, searchName: row.criteria.name })));
  });
  app.get('/api/discoveries', async request => {
    const result = await db.query(`SELECT d.payload,s.id AS "searchId",s.criteria->>'name' AS "searchName"
      FROM discoveries d JOIN searches s ON s.id=d.search_id WHERE s.user_id=$1
      AND (s.criteria->>'active')::boolean=true AND (s.criteria->>'latestReturn')::date>=current_date
      AND d.payload->>'type'<>'flight'
      AND (d.payload->>'checkedAt')::timestamptz>now()-interval '48 hours'`, [request.userId]);
    return result.rows.map(row => ({ ...row.payload, searchId: row.searchId, searchName: row.searchName }));
  });
  app.get('/api/offers', async request => {
    const result = await db.query(`SELECT o.payload,s.criteria,s.id AS "searchId",s.criteria->>'name' AS "searchName"
      FROM offers o JOIN searches s ON s.id=o.search_id WHERE s.user_id=$1
      AND (s.criteria->>'active')::boolean=true AND (o.payload->>'checkedAt')::timestamptz>now()-interval '48 hours'
      AND (o.payload->>'departureDate')::date>=current_date`, [request.userId]);
    return result.rows.flatMap(row => specificOffers(searchSchema.parse(row.criteria), [offerSchema.parse(row.payload)])
      .map(offer => ({ ...offer, searchId: row.searchId, searchName: row.searchName })));
  });
  const webRoot = resolve('apps/web/dist');
  if (existsSync(webRoot)) {
    await app.register(serveStatic, { root: webRoot });
    app.setNotFoundHandler((request, reply) => request.url.startsWith('/api/')
      ? reply.code(404).send({ error: 'Not found' }) : reply.sendFile('index.html'));
  }
  return app;
}
