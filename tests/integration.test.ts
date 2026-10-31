import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { searchSchema } from '../packages/shared/src/index.js';

// The integration suite only runs against an explicitly provided disposable database.
test('invite-only accounts, ownership, daily Graph digests and ambiguous sends', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.NODE_ENV = 'test';
  process.env.APP_URL = 'http://localhost:5173';
  process.env.EMAIL_MODE = 'graph';
  process.env.GRAPH_TENANT_ID = 'test-tenant';
  process.env.GRAPH_CLIENT_ID = 'test-client';
  process.env.GRAPH_CLIENT_SECRET = 'test-secret';
  process.env.GRAPH_SENDER = 'test@example.com';
  const { db, migrate } = await import('../apps/api/src/db.js');
  const { token, hashToken } = await import('../apps/api/src/auth.js');
  const { createApp } = await import('../apps/api/src/app.js');
  const { tick } = await import('../apps/worker/src/jobs.js');
  const { providers } = await import('../packages/providers/src/index.js');
  const { config } = await import('../apps/api/src/config.js');
  const realProviders = providers.splice(0);
  const originalFetch = globalThis.fetch;
  await migrate();
  const app = await createApp();
  const emails: unknown[] = [];
  let failSending = false;
  globalThis.fetch = async (url, options) => {
    if (String(url).includes('login.microsoftonline.com')) {
      assert.equal(new URLSearchParams(String(options?.body)).get('scope'), 'https://graph.microsoft.com/.default');
      return new Response(JSON.stringify({ access_token: 'mock-token', expires_in: 3600 }), { status: 200 });
    }
    assert.equal(String(url), 'https://graph.microsoft.com/v1.0/users/test%40example.com/sendMail');
    assert.equal(new Headers(options?.headers).get('Authorization'), 'Bearer mock-token');
    emails.push(JSON.parse(String(options?.body)));
    if (failSending) throw new Error('Simulated ambiguous network timeout');
    return new Response(null, { status: 202 });
  };
  const created: string[] = [];
  const inviteHashes: string[] = [];
  const origin = { origin: 'http://localhost:5173' };
  try {
    assert.equal((await app.inject({ url: '/api/searches' })).statusCode, 401);
    assert.equal((await app.inject({ method: 'POST', url: '/api/auth/login', payload: {}, headers: { origin: 'https://evil.example' } })).statusCode, 403);
    async function register() {
      const email = `${randomUUID()}@example.com`;
      const invitation = token();
      const hash = hashToken(invitation); inviteHashes.push(hash);
      await db.query(`INSERT INTO invitations VALUES ($1,$2,now()+interval '1 day',NULL)`, [hash, email]);
      const payload = { email, password: 'a-valid-long-password', invitation };
      const result = await app.inject({ method: 'POST', url: '/api/auth/register', headers: origin, payload });
      assert.equal(result.statusCode, 200, result.body);
      const row = await db.query('SELECT id FROM users WHERE email=$1', [email]);
      created.push(row.rows[0].id);
      const cookie = String(result.headers['set-cookie']).split(';')[0]!;
      const reused = await app.inject({ method: 'POST', url: '/api/auth/register', headers: origin, payload });
      assert.equal(reused.statusCode, 400);
      return { cookie, id: row.rows[0].id, email };
    }
    const first = await register(); const second = await register();
    config.NODE_ENV = 'development';
    const aliasLogin = await app.inject({ method: 'POST', url: '/api/auth/login',
      headers: { origin: 'http://127.0.0.1:5173' }, payload: { email: first.email, password: 'a-valid-long-password' } });
    config.NODE_ENV = 'test';
    assert.equal(aliasLogin.statusCode, 200, 'login should accept the frontend URL printed by Vite in development');
    const invalid = await app.inject({ method: 'POST', url: '/api/auth/register', headers: origin,
      payload: { email: 'uninvited@example.com', password: 'a-valid-long-password', invitation: token() } });
    assert.equal(invalid.statusCode, 400);
    const payload = { name: 'Family escape', departure: 'Bucharest', targetCountry: 'IT', targetCities: ['Rome'], earliestDeparture: '2027-02-01', latestReturn: '2027-02-28',
      minNights: 5, maxNights: 8, adults: 2, childrenAges: [4, 8], rooms: 1, tripTypes: ['package', 'flight', 'stay'], swimming: 'sea' };
    const saved = await app.inject({ method: 'POST', url: '/api/searches', headers: { ...origin, cookie: first.cookie }, payload });
    assert.equal(saved.statusCode, 201, saved.body);
    const id = saved.json().id;
    const other = await app.inject({ url: '/api/searches', headers: { cookie: second.cookie } });
    assert.deepEqual(other.json(), []);
    assert.equal((await app.inject({ method: 'POST', url: `/api/searches/${id}/run`, headers: { ...origin, cookie: second.cookie }, payload: {} })).statusCode, 404);
    assert.equal((await app.inject({ method: 'DELETE', url: `/api/searches/${id}`, headers: { ...origin, cookie: second.cookie }, payload: {} })).statusCode, 404);
    assert.equal((await app.inject({ url: '/api/me', headers: { cookie: first.cookie } })).json().timezone, 'Europe/Bucharest');

    providers.push({ id: 'mock-provider', liveRoundTripFlights: true, search: async criteria => [{ provider: 'mock-provider', externalId: 'family-1',
      title: 'A family deal', destination: 'Rome', destinationCountry: 'IT', type: 'package', departureDate: '2027-02-10', returnDate: '2027-02-17',
      totalMinor: 120000, currency: 'EUR', priceBasis: 'family-total', booking: { reference: 'package-1', description: 'Specific family package quote.', linkKind: 'specific-offer' }, adults: criteria.adults, childrenAges: criteria.childrenAges,
      url: 'https://example.com/deal', inclusions: ['Flights', 'Hotel'], swimming: 'unknown', swimmingEvidence: 'Not verified',
      checkedAt: new Date().toISOString() }, ...(['flight', 'stay'] as const).map(type => ({
        provider: 'mock-provider', externalId: `quoted-${type}`, title: `Family ${type}`, destination: 'Rome', destinationCountry: 'IT', type,
        ...(type === 'flight' ? { journey: 'round-trip' as const } : {}),
        departureDate: '2027-02-10', returnDate: '2027-02-17', totalMinor: type === 'flight' ? 40000 : 25000,
        currency: 'EUR' as const, priceBasis: 'family-total' as const, adults: criteria.adults, childrenAges: criteria.childrenAges,
        booking: { reference: `quote-${type}`, description: type === 'flight' ? 'Return flight OTP–FCO for the family.' : 'One family room, seven nights.', live: true, linkKind: 'specific-offer' as const, ...(type === 'stay' ? { rooms: 1 } : {}) },
        url: `https://example.com/${type === 'flight' ? 'flight' : 'stay'}`, inclusions: [], swimming: 'unknown' as const,
        swimmingEvidence: '', checkedAt: new Date().toISOString(),
      }))], discover: async () => [{ provider: 'mock-provider', externalId: 'ad-1',
      title: 'Advertised holiday', destination: 'Rome', destinationCountry: 'IT', type: 'package', fromMinor: 10000, currency: 'EUR', priceUnit: 'person',
      url: 'https://example.com/advert', departureCities: [], departureDates: [], nights: null,
      conditions: 'Dates and family total are not confirmed.', checkedAt: new Date().toISOString() },
      { provider: 'mock-provider', externalId: 'flight-ad', title: 'Test flight', destination: 'Rome', type: 'flight', fromMinor: 10000,
        currency: 'EUR', priceUnit: 'person', journey: 'round-trip', url: 'https://example.com/flight', departureCities: ['Bucharest'],
        departureDates: [], nights: null, conditions: 'Family price not confirmed.', checkedAt: new Date().toISOString() },
      { provider: 'mock-provider', externalId: 'stay-ad', title: 'Test hotel', destination: 'Roma', type: 'stay', fromMinor: 5000,
        currency: 'EUR', priceUnit: 'room-night', basisAssumed: true, url: 'https://example.com/stay', departureCities: [],
        departureDates: [], nights: null, conditions: 'Capacity and nightly basis not confirmed.', checkedAt: new Date().toISOString() }] });
    config.EMAIL_MODE = 'disabled';
    const manual = await app.inject({ method: 'POST', url: `/api/searches/${id}/run`, headers: { ...origin, cookie: first.cookie }, payload: {} });
    assert.equal(manual.statusCode, 200, manual.body);
    assert.equal(manual.json().discoveries, 2);
    assert.equal(manual.json().combinations, 1);
    assert.equal(emails.length, 0, 'manual collection works with email disabled and sends no mail');
    assert.equal((await app.inject({ method: 'POST', url: `/api/searches/${id}/run`, headers: { ...origin, cookie: first.cookie }, payload: {} })).statusCode, 429);
    const leads = await app.inject({ url: '/api/discoveries', headers: { cookie: first.cookie } });
    assert.ok(leads.json().some((d: { priceUnit: string }) => d.priceUnit === 'person'));
    assert.equal(leads.json().some((d: { type: string }) => d.type === 'flight'), false);
    assert.equal((await app.inject({ url: '/api/discoveries', headers: { cookie: second.cookie } })).json().length, 0);
    const combined = await app.inject({ url: '/api/trips', headers: { cookie: first.cookie } });
    assert.equal(combined.statusCode, 200);
    assert.equal(combined.json().length, 1);
    assert.equal(combined.json()[0].totalMinor, 65000);
    assert.equal(combined.json()[0].perPersonMinor, 16250);
    assert.equal(combined.json()[0].flight.booking.reference, 'quote-flight');
    assert.equal(combined.json()[0].stay.booking.reference, 'quote-stay');
    assert.equal(combined.json()[0].flight.url, 'https://example.com/flight');
    assert.equal(combined.json()[0].stay.url, 'https://example.com/stay');
    const oldPayload = (await db.query('SELECT payload FROM offers WHERE search_id=$1 LIMIT 1', [id])).rows[0].payload;
    delete oldPayload.booking;
    oldPayload.externalId = 'legacy-without-quote-link';
    await db.query('INSERT INTO offers VALUES ($1,$2,$3,$4)', [id, oldPayload.provider, oldPayload.externalId, oldPayload]);
    const exactList = (await app.inject({ url: '/api/offers', headers: { cookie: first.cookie } })).json();
    assert.equal(exactList.length, 3);
    assert.equal(exactList.some((o: { externalId: string }) => o.externalId === oldPayload.externalId), false,
      'older saved records without an individual quote link must not appear as specific offers');
    assert.deepEqual((await app.inject({ url: '/api/trips', headers: { cookie: second.cookie } })).json(), []);
    await tick(new Date('2027-01-04T06:00:00Z'));
    assert.equal(emails.length, 0, 'scheduled collection also works without email');
    assert.equal((await db.query('SELECT status FROM digests WHERE user_id=$1 AND local_day=$2', [first.id, '2027-01-04'])).rows[0].status, 'collected');
    config.EMAIL_MODE = 'graph';
    await tick(new Date('2027-01-01T05:59:00Z'));
    assert.equal(emails.length, 0);
    await tick(new Date('2027-01-01T06:00:00Z'));
    await tick(new Date('2027-01-01T06:01:00Z'));
    assert.equal(emails.length, 1, 'one combined digest per user/day');
    assert.ok(JSON.stringify(emails[0]).includes('family total'));
    assert.ok(JSON.stringify(emails[0]).includes('not confirmed family quotes'));
    assert.ok(JSON.stringify(emails[0]).includes('SUM OF QUOTED TOTALS'));
    assert.equal(JSON.stringify(emails[0]).includes('ILLUSTRATIVE BUDGET'), false);
    assert.ok(JSON.stringify(emails[0]).includes('quote-flight'));
    assert.ok(JSON.stringify(emails[0]).includes('https://example.com/flight'));
    assert.ok(JSON.stringify(emails[0]).includes('https://example.com/stay'));
    assert.equal((await app.inject({ url: '/api/offers', headers: { cookie: first.cookie } })).json().length, 3);
    assert.deepEqual((await app.inject({ url: '/api/offers', headers: { cookie: second.cookie } })).json(), []);
    await app.inject({ method: 'PATCH', url: '/api/me', headers: { ...origin, cookie: first.cookie }, payload: { digestEnabled: false } });
    await tick(new Date('2027-01-02T06:00:00Z'));
    assert.equal(emails.length, 1, 'paused digests are not sent');
    await app.inject({ method: 'PATCH', url: '/api/me', headers: { ...origin, cookie: first.cookie }, payload: { digestEnabled: true } });
    failSending = true;
    await tick(new Date('2027-01-03T06:00:00Z'));
    await tick(new Date('2027-01-03T07:00:00Z'));
    assert.equal(emails.length, 2, 'ambiguous Graph requests are not blindly retried');
    const record = await db.query('SELECT status FROM digests WHERE user_id=$1 AND local_day=$2', [first.id, '2027-01-03']);
    assert.equal(record.rows[0].status, 'uncertain');

    // Required country and multi-city destinations survive storage and apply to manual collection.
    const targeted = await app.inject({ method: 'POST', url: '/api/searches', headers: { ...origin, cookie: first.cookie },
      payload: { ...payload, name: 'Italy only', targetCountry: 'IT', targetCities: ['Rome'] } });
    assert.equal(targeted.statusCode, 201, targeted.body);
    const targetId = targeted.json().id;
    const savedTarget = (await app.inject({ url: '/api/searches', headers: { cookie: first.cookie } })).json()
      .find((s: { id: string }) => s.id === targetId);
    assert.equal(savedTarget.targetCountry, 'IT'); assert.deepEqual(savedTarget.targetCities, ['Rome']);
    const targetRun = await app.inject({ method: 'POST', url: `/api/searches/${targetId}/run`, headers: { ...origin, cookie: first.cookie }, payload: {} });
    assert.equal(targetRun.statusCode, 200, targetRun.body);
    assert.equal(targetRun.json().offers, 2); assert.equal(targetRun.json().discoveries, 1); assert.equal(targetRun.json().combinations, 1);
    const headers = { ...origin, cookie: first.cookie };
    assert.equal((await app.inject({ method: 'PATCH', url: `/api/searches/${targetId}`, headers: { ...origin, cookie: second.cookie },
      payload: { targetCountry: 'GR' } })).statusCode, 404);
    assert.equal((await app.inject({ method: 'PATCH', url: `/api/searches/${targetId}`, headers,
      payload: { targetCities: [], targetCountry: 'MT' } })).statusCode, 200);
    const afterChange = (await app.inject({ url: '/api/discoveries', headers })).json();
    assert.equal(afterChange.filter((d: { searchId: string }) => d.searchId === targetId).length, 0, 'old destination results must be cleared');
    const emptyRun = await app.inject({ method: 'POST', url: `/api/searches/${targetId}/run`, headers, payload: {} });
    assert.equal(emptyRun.statusCode, 200, emptyRun.body);
    assert.equal(emptyRun.json().discoveries, 0, 'cooldown resets when the destination changes');
    assert.equal((await app.inject({ method: 'PATCH', url: `/api/searches/${targetId}`, headers,
      payload: { targetCountry: 'invalid country' } })).statusCode, 400);
    assert.equal((await app.inject({ method: 'PATCH', url: `/api/searches/${targetId}`, headers,
      payload: { targetCountry: '' } })).statusCode, 400);
    assert.equal((await app.inject({ method: 'PATCH', url: `/api/searches/${targetId}`, headers,
      payload: { targetCountry: 'IT', targetCities: ['Rome'] } })).statusCode, 200);
    const allRun = await app.inject({ method: 'POST', url: `/api/searches/${targetId}/run`, headers, payload: {} });
    assert.equal(allRun.statusCode, 200, allRun.body);
    assert.equal(allRun.json().offers, 3); assert.equal(allRun.json().discoveries, 2);

    // Existing teaser records and old flight quotes must not reappear after an upgrade.
    const oldFlight = { ...(await db.query("SELECT payload FROM offers WHERE search_id=$1 AND payload->>'type'='flight'", [targetId])).rows[0].payload,
      externalId: 'old-flight-without-live-quote' };
    delete oldFlight.journey; delete oldFlight.booking.live;
    await db.query('INSERT INTO offers VALUES ($1,$2,$3,$4)', [targetId, oldFlight.provider, oldFlight.externalId, oldFlight]);
    await db.query('INSERT INTO discoveries VALUES ($1,$2,$3,$4)', [targetId, 'legacy', 'teaser', {
      provider: 'legacy', externalId: 'teaser', type: 'flight', fromMinor: 3700, checkedAt: new Date().toISOString(),
    }]);
    assert.equal((await app.inject({ url: '/api/offers', headers })).json()
      .some((o: { externalId: string }) => o.externalId === oldFlight.externalId), false);
    assert.equal((await app.inject({ url: '/api/discoveries', headers })).json().some((d: { type: string }) => d.type === 'flight'), false);
    await db.query('DELETE FROM offers WHERE search_id=$1 AND external_id=$2', [targetId, oldFlight.externalId]);
    await db.query('DELETE FROM discoveries WHERE search_id=$1 AND provider=$2', [targetId, 'legacy']);

    // Renaming preserves results; all matching settings can be edited and invalidate old results.
    const snapshot = (await db.query('SELECT criteria,last_checked_at,last_status FROM searches WHERE id=$1', [targetId])).rows[0];
    assert.equal((await app.inject({ method: 'PATCH', url: `/api/searches/${targetId}`, headers,
      payload: { name: 'Renamed search' } })).statusCode, 200);
    const renamed = (await db.query('SELECT criteria,last_checked_at,last_status FROM searches WHERE id=$1', [targetId])).rows[0];
    assert.deepEqual(renamed.criteria, { ...snapshot.criteria, name: 'Renamed search' });
    assert.deepEqual(renamed.last_checked_at, snapshot.last_checked_at);
    assert.equal(renamed.last_status, snapshot.last_status);
    assert.equal((await db.query('SELECT count(*) FROM offers WHERE search_id=$1', [targetId])).rows[0].count, '3');

    for (const invalid of [{ minNights: 9, maxNights: 3 }, { latestReturn: '2027-01-01' },
      { childrenAges: [18] }, { tripTypes: [] }, { rooms: 7 }, { user_id: second.id }, {}]) {
      const rejected = await app.inject({ method: 'PATCH', url: `/api/searches/${targetId}`, headers, payload: invalid });
      assert.equal(rejected.statusCode, 400, rejected.body);
    }
    assert.deepEqual((await db.query('SELECT criteria FROM searches WHERE id=$1', [targetId])).rows[0].criteria, renamed.criteria,
      'invalid edits must leave the saved search unchanged');

    const fullEdit = { name: 'All settings edited', departure: 'Cluj', targetCities: ['Brasov'], targetCountry: 'RO',
      nearbyAirports: false, earliestDeparture: '2027-03-01', latestReturn: '2027-03-31', minNights: 3, maxNights: 5,
      adults: 3, childrenAges: [6], rooms: 2, currency: 'RON', tripTypes: ['stay'], swimming: 'heated-pool',
      preferences: 'A quiet hotel with a heated pool.', active: false };
    assert.equal((await app.inject({ method: 'PATCH', url: `/api/searches/${targetId}`,
      headers: { ...origin, cookie: second.cookie }, payload: fullEdit })).statusCode, 404);
    const edited = await app.inject({ method: 'PATCH', url: `/api/searches/${targetId}`, headers, payload: fullEdit });
    assert.equal(edited.statusCode, 200, edited.body);
    const storedEdit = (await db.query('SELECT criteria,last_checked_at,last_status FROM searches WHERE id=$1', [targetId])).rows[0];
    assert.deepEqual(storedEdit.criteria, searchSchema.parse(fullEdit));
    assert.equal(storedEdit.last_checked_at, null); assert.equal(storedEdit.last_status, null);
    for (const table of ['offers', 'discoveries']) {
      assert.equal((await db.query(`SELECT count(*) FROM ${table} WHERE search_id=$1`, [targetId])).rows[0].count, '0');
    }
    const reloadedEdit = (await app.inject({ url: '/api/searches', headers })).json().find((s: { id: string }) => s.id === targetId);
    assert.deepEqual(searchSchema.parse(reloadedEdit), searchSchema.parse(fullEdit));
    assert.equal((await app.inject({ method: 'PATCH', url: `/api/searches/${targetId}`, headers,
      payload: { active: true } })).statusCode, 200);
    assert.deepEqual((await db.query('SELECT criteria FROM searches WHERE id=$1', [targetId])).rows[0].criteria,
      { ...storedEdit.criteria, active: true }, 'partial status updates must preserve every edited field');

    // An edit during provider collection must not let the previous criteria repopulate results.
    const { runSearch } = await import('../apps/api/src/search-runner.js');
    let release!: () => void; let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const inFlight = runSearch(targetId, { adapters: [{ id: 'slow', discover: async () => { started(); await waiting; return []; } }] });
    await ready;
    try {
      assert.equal((await app.inject({ method: 'PATCH', url: `/api/searches/${targetId}`, headers,
        payload: { targetCountry: 'IT' } })).statusCode, 200);
    } finally { release(); }
    await assert.rejects(inFlight, /settings changed/);

    await app.inject({ method: 'POST', url: '/api/logout', headers: { ...origin, cookie: first.cookie }, payload: {} });
    assert.equal((await app.inject({ url: '/api/me', headers: { cookie: first.cookie } })).statusCode, 401);
    assert.equal((await app.inject({ url: '/api/trips', headers: { cookie: first.cookie } })).statusCode, 401);
  } finally {
    providers.splice(0, providers.length, ...realProviders); globalThis.fetch = originalFetch;
    await app.close();
    await db.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [created]);
    await db.query('DELETE FROM invitations WHERE token_hash=ANY($1::text[])', [inviteHashes]);
    await db.end();
  }
});
