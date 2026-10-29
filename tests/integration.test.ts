import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

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
    const invalid = await app.inject({ method: 'POST', url: '/api/auth/register', headers: origin,
      payload: { email: 'uninvited@example.com', password: 'a-valid-long-password', invitation: token() } });
    assert.equal(invalid.statusCode, 400);
    const payload = { name: 'Family escape', departure: 'Bucharest', earliestDeparture: '2027-02-01', latestReturn: '2027-02-28',
      minNights: 5, maxNights: 8, adults: 2, childrenAges: [4, 8], tripTypes: ['package'], swimming: 'sea' };
    const saved = await app.inject({ method: 'POST', url: '/api/searches', headers: { ...origin, cookie: first.cookie }, payload });
    assert.equal(saved.statusCode, 201, saved.body);
    const id = saved.json().id;
    const other = await app.inject({ url: '/api/searches', headers: { cookie: second.cookie } });
    assert.deepEqual(other.json(), []);
    assert.equal((await app.inject({ method: 'POST', url: `/api/searches/${id}/run`, headers: { ...origin, cookie: second.cookie }, payload: {} })).statusCode, 404);
    assert.equal((await app.inject({ method: 'DELETE', url: `/api/searches/${id}`, headers: { ...origin, cookie: second.cookie }, payload: {} })).statusCode, 404);
    assert.equal((await app.inject({ url: '/api/me', headers: { cookie: first.cookie } })).json().timezone, 'Europe/Bucharest');

    providers.push({ id: 'mock-provider', search: async criteria => [{ provider: 'mock-provider', externalId: 'family-1',
      title: 'A family deal', destination: 'A sunny place', type: 'package', departureDate: '2027-02-10', returnDate: '2027-02-17',
      totalMinor: 120000, currency: 'EUR', priceBasis: 'family-total', adults: criteria.adults, childrenAges: criteria.childrenAges,
      url: 'https://example.com/deal', inclusions: ['Flights', 'Hotel'], swimming: 'unknown', swimmingEvidence: 'Not verified',
      checkedAt: new Date().toISOString() }], discover: async () => [{ provider: 'mock-provider', externalId: 'ad-1',
      title: 'Advertised holiday', destination: 'Test coast', type: 'package', fromMinor: 10000, currency: 'EUR', priceUnit: 'person',
      url: 'https://example.com/advert', departureCities: [], departureDates: [], nights: null,
      conditions: 'Dates and family total are not confirmed.', checkedAt: new Date().toISOString() }] });
    config.EMAIL_MODE = 'disabled';
    const manual = await app.inject({ method: 'POST', url: `/api/searches/${id}/run`, headers: { ...origin, cookie: first.cookie }, payload: {} });
    assert.equal(manual.statusCode, 200, manual.body);
    assert.equal(manual.json().discoveries, 1);
    assert.equal(emails.length, 0, 'manual collection works with email disabled and sends no mail');
    assert.equal((await app.inject({ method: 'POST', url: `/api/searches/${id}/run`, headers: { ...origin, cookie: first.cookie }, payload: {} })).statusCode, 429);
    const leads = await app.inject({ url: '/api/discoveries', headers: { cookie: first.cookie } });
    assert.equal(leads.json()[0].priceUnit, 'person');
    assert.equal((await app.inject({ url: '/api/discoveries', headers: { cookie: second.cookie } })).json().length, 0);
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
    assert.equal((await app.inject({ url: '/api/offers', headers: { cookie: first.cookie } })).json().length, 1);
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
    await app.inject({ method: 'POST', url: '/api/logout', headers: { ...origin, cookie: first.cookie }, payload: {} });
    assert.equal((await app.inject({ url: '/api/me', headers: { cookie: first.cookie } })).statusCode, 401);
  } finally {
    providers.splice(0, providers.length, ...realProviders); globalThis.fetch = originalFetch;
    await app.close();
    await db.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [created]);
    await db.query('DELETE FROM invitations WHERE token_hash=ANY($1::text[])', [inviteHashes]);
    await db.end();
  }
});
