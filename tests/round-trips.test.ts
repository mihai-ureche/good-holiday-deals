import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flightDatePairs, roundTripPrice, topFlightOffers, topFlightOffersPerAirport } from '../packages/shared/src/flights.js';
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
test('every valid departure and return pair is generated for the flexible window', () => {
  const pairs = flightDatePairs({ earliestDeparture: '2027-02-20', latestReturn: '2027-02-28', minNights: 4, maxNights: 6 });
  assert.deepEqual(pairs, [
    { departureDate: '2027-02-20', returnDate: '2027-02-24', nights: 4 },
    { departureDate: '2027-02-21', returnDate: '2027-02-25', nights: 4 },
    { departureDate: '2027-02-22', returnDate: '2027-02-26', nights: 4 },
    { departureDate: '2027-02-23', returnDate: '2027-02-27', nights: 4 },
    { departureDate: '2027-02-24', returnDate: '2027-02-28', nights: 4 },
    { departureDate: '2027-02-20', returnDate: '2027-02-25', nights: 5 },
    { departureDate: '2027-02-21', returnDate: '2027-02-26', nights: 5 },
    { departureDate: '2027-02-22', returnDate: '2027-02-27', nights: 5 },
    { departureDate: '2027-02-23', returnDate: '2027-02-28', nights: 5 },
    { departureDate: '2027-02-20', returnDate: '2027-02-26', nights: 6 },
    { departureDate: '2027-02-21', returnDate: '2027-02-27', nights: 6 },
    { departureDate: '2027-02-22', returnDate: '2027-02-28', nights: 6 },
  ]);
});
test('only the five cheapest valid live flight offers are selected', () => {
  const offers = [7, 2, 6, 1, 5, 3, 4].map((price, index) => ({ ...quote,
    externalId: `quote-${index}`, totalMinor: price * 10000 }));
  assert.deepEqual(topFlightOffers(offers).map(offer => offer.totalMinor), [10000, 20000, 30000, 40000, 50000]);
  assert.deepEqual(topFlightOffers([{ ...quote, journey: 'one-way' }, ...offers], 2).map(offer => offer.totalMinor), [10000, 20000]);
});
test('airport results retain the three cheapest variants for every airport', () => {
  const offers = ['MAD', 'BCN'].flatMap((airport, airportIndex) => [4, 1, 3, 2].map((price, index) => ({ ...quote,
    externalId: `${airport}-${index}`, destination: airport, destinationAirport: airport,
    totalMinor: (price + airportIndex * 10) * 10000 })));
  assert.deepEqual(topFlightOffersPerAirport(offers).map(offer => `${offer.destinationAirport}:${offer.totalMinor}`),
    ['MAD:10000', 'MAD:20000', 'MAD:30000', 'BCN:110000', 'BCN:120000', 'BCN:130000']);
});
test('two searches to the same airport each keep their own three cheapest variants', () => {
  const offers = ['winter', 'spring'].flatMap(searchId => [4, 1, 3, 2].map((price, index) => ({ ...quote, searchId,
    externalId: `${searchId}-${index}`, destination: 'MAD', destinationAirport: 'MAD', totalMinor: price * 10000 })));
  assert.deepEqual(topFlightOffersPerAirport(offers).map(offer => `${offer.searchId}:${offer.totalMinor}`),
    ['winter:10000', 'spring:10000', 'winter:20000', 'spring:20000', 'winter:30000', 'spring:30000']);
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
  const criteria = searchSchema.parse({ name: 'Round trips', departure: 'OTP', targetCountry: 'IT', targetCities: ['Rome'], earliestDeparture: '2027-02-20',
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
