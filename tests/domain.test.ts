import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localSchedule, searchSchema, matchingOffers, type Offer } from '../packages/shared/src/index.js';
import { collect } from '../packages/providers/src/index.js';
import { hashPassword, verifyPassword } from '../apps/api/src/auth.js';

const search = searchSchema.parse({ name: 'February sun', departure: 'Bucharest', targetCountry: 'GR', targetCities: ['Athens'], earliestDeparture: '2027-02-01',
  latestReturn: '2027-02-28', minNights: 5, maxNights: 8, adults: 2, childrenAges: [4, 8], tripTypes: ['package', 'flight', 'stay'] });
const offer: Offer = { provider: 'test', externalId: '1', title: 'Family stay', destination: 'Athens', destinationCountry: 'GR', type: 'package',
  departureDate: '2027-02-10', returnDate: '2027-02-17', totalMinor: 120000, currency: 'EUR', priceBasis: 'family-total', booking: { reference: 'test-quote', description: 'Specific package for the selected party and dates.', linkKind: 'specific-offer' },
  adults: 2, childrenAges: [8, 4], url: 'https://example.com/offer', inclusions: ['Flights', 'Hotel'],
  swimming: 'unknown', swimmingEvidence: 'Not verified', checkedAt: '2026-10-29T08:00:00.000Z' };

test('08:00 Bucharest follows daylight saving, including transition days', () => {
  assert.equal(localSchedule(new Date('2027-02-01T05:59:00Z'), 'Europe/Bucharest').due, false);
  assert.equal(localSchedule(new Date('2027-02-01T06:00:00Z'), 'Europe/Bucharest').due, true);
  assert.equal(localSchedule(new Date('2027-07-01T05:00:00Z'), 'Europe/Bucharest').due, true);
  assert.equal(localSchedule(new Date('2027-03-28T05:00:00Z'), 'Europe/Bucharest').due, true);
  assert.equal(localSchedule(new Date('2027-10-31T06:00:00Z'), 'Europe/Bucharest').due, true);
  assert.equal(localSchedule(new Date('2027-02-01T10:00:00Z'), 'Europe/Bucharest').due, false);
  assert.equal(localSchedule(new Date('2027-02-01T22:30:00Z'), 'Europe/Bucharest').day, '2027-02-02');
});
test('travel windows must fit the stay and child ages must be valid', () => {
  assert.equal(searchSchema.safeParse({ ...search, maxNights: 4 }).success, false);
  assert.equal(searchSchema.safeParse({ ...search, latestReturn: '2027-02-03' }).success, false);
  assert.equal(searchSchema.safeParse({ ...search, childrenAges: [18] }).success, false);
  assert.equal(searchSchema.safeParse({ ...search, childrenAges: [1], lapInfants: 2 }).success, false);
  assert.equal(searchSchema.safeParse({ ...search, adults: 1, childrenAges: [0, 1], lapInfants: 2 }).success, false);
  assert.equal(searchSchema.safeParse({ ...search, adults: 8, childrenAges: [8, 10], tripTypes: ['flight'] }).success, false);
  assert.equal(searchSchema.safeParse({ ...search, tripTypes: [] }).success, false);
});
test('family composition, date window, type and currency are enforced before sorting', () => {
  const offers: Offer[] = [offer, { ...offer, externalId: 'cheap', totalMinor: 90000 },
    { ...offer, externalId: 'wrong-party', childrenAges: [] }, { ...offer, externalId: 'usd', currency: 'USD' },
    { ...offer, externalId: 'late-return', returnDate: '2027-03-04' }, { ...offer, externalId: 'short', returnDate: '2027-02-11' }];
  assert.deepEqual(matchingOffers(search, offers).map(o => o.externalId), ['cheap', '1']);
  assert.equal(matchingOffers({ ...search, tripTypes: ['flight'] }, [offer]).length, 0);
  // Swimming stays a preference: unknown conditions must not silently exclude a good offer.
  assert.equal(matchingOffers({ ...search, swimming: 'sea' }, [offer]).length, 1);
});
test('source failures are isolated; results validated, deduplicated and attributed', async () => {
  const result = await collect(search, [{ id: 'broken', search: async () => { throw new Error('timeout'); } },
    { id: 'valid', search: async () => [offer, offer] },
    { id: 'unsafe', search: async () => [{ ...offer, url: 'javascript:alert(1)' }] }]);
  assert.deepEqual(result.failures, ['broken', 'unsafe']);
  assert.equal(result.offers.length, 1);
  assert.equal(result.offers[0]?.provider, 'valid');
});
test('empty provider registry returns no invented deals', async () => {
  assert.deepEqual(await collect(search, []), { offers: [], discoveries: [], failures: [], configured: 0 });
});
test('passwords are salted and verified', async () => {
  const first = await hashPassword('a-long-test-password');
  const second = await hashPassword('a-long-test-password');
  assert.notEqual(first, second);
  assert.equal(await verifyPassword('a-long-test-password', first), true);
  assert.equal(await verifyPassword('wrong-password', first), false);
});
