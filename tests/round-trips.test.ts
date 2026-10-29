import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roundTripPrice } from '../packages/shared/src/flights.js';
import { searchSchema, type Offer } from '../packages/shared/src/index.js';
import { collect } from '../packages/providers/src/index.js';

const quote: Offer = { provider: 'test', externalId: 'live-return', title: 'Return flight', type: 'flight', journey: 'round-trip',
  destination: 'Rome', departureDate: '2027-02-20', returnDate: '2027-02-25', totalMinor: 40000, currency: 'EUR',
  priceBasis: 'family-total', adults: 2, childrenAges: [14, 16], url: 'https://example.com/quote/live-return',
  booking: { live: true, reference: 'live-return', description: 'Two adults and two children, both flight legs.', linkKind: 'specific-offer' },
  inclusions: [], swimming: 'unknown', swimmingEvidence: '', checkedAt: new Date().toISOString() };

test('round-trip rows divide the quoted party total to show the average and retain the exact total', () => {
  assert.deepEqual(roundTripPrice(quote), { travelers: 4, perPersonMinor: 10000, totalMinor: 40000 });
  assert.deepEqual(roundTripPrice({ ...quote, totalMinor: 35600, returnDate: '2027-02-26' }),
    { travelers: 4, perPersonMinor: 8900, totalMinor: 35600 });
  assert.equal(roundTripPrice({ ...quote, totalMinor: 40001 })?.totalMinor, 40001, 'rounding the average must never change the quoted total');
});
test('one-way, indicative, old, expired and non-live flights cannot become priced round-trip rows', () => {
  for (const invalid of [
    { ...quote, journey: 'one-way' as const }, { ...quote, journey: undefined },
    { ...quote, booking: { ...quote.booking!, live: false } }, { ...quote, booking: { ...quote.booking!, live: undefined } },
    { ...quote, priceBasis: 'indicative' as const }, { ...quote, returnDate: quote.departureDate },
    { ...quote, booking: undefined },
    { ...quote, booking: { ...quote.booking!, expiresAt: new Date(Date.now() - 1000).toISOString() } },
    { ...quote, checkedAt: new Date(Date.now() - 49 * 3600000).toISOString() },
  ]) assert.equal(roundTripPrice(invalid), null);
});
test('flight-only collection skips promotion scraping and returns no invented fares', async () => {
  const criteria = searchSchema.parse({ name: 'Round trips', departure: 'OTP', earliestDeparture: '2027-02-20',
    latestReturn: '2027-02-28', minNights: 4, maxNights: 6, adults: 2, childrenAges: [14, 16], tripTypes: ['flight'] });
  let called = false;
  const result = await collect(criteria, [{ id: 'promotions', discover: async () => { called = true; return []; } }]);
  assert.equal(called, false); assert.equal(result.configured, 0);
  assert.deepEqual(result.offers, []); assert.deepEqual(result.discoveries, []);
  const live = await collect(criteria, [{ id: 'live', liveRoundTripFlights: true, search: async () => [quote,
    { ...quote, externalId: 'one-way', journey: 'one-way' }, { ...quote, externalId: 'wrong-party', childrenAges: [] }] }]);
  assert.deepEqual(live.offers.map(offer => offer.externalId), ['live-return']);
  assert.equal(live.offers[0]?.totalMinor, 40000);
});
