import { test } from 'node:test';
import assert from 'node:assert/strict';
import { combineTrips } from '../packages/shared/src/combinations.js';
import { searchSchema, type Offer, type Discovery } from '../packages/shared/src/index.js';

const criteria = searchSchema.parse({ name: 'Family holiday', departure: 'Bucharest', earliestDeparture: '2027-02-01', latestReturn: '2027-02-28',
  minNights: 5, maxNights: 8, adults: 2, childrenAges: [4, 8], rooms: 2, tripTypes: ['flight', 'stay'], currency: 'EUR' });
const now = new Date().toISOString();
const flight: Discovery = { provider: 'flight', externalId: 'f1', title: 'Flight', destination: 'Rome', type: 'flight', fromMinor: 10000,
  currency: 'EUR', priceUnit: 'person', journey: 'round-trip', url: 'https://example.com/flight', departureCities: ['Bucharest'], departureDates: [], nights: null,
  conditions: 'Advertised fare; verify family availability.', checkedAt: now };
const stay: Discovery = { ...flight, provider: 'hotel', externalId: 'h1', title: 'Hotel', destination: 'Roma', type: 'stay', fromMinor: 5000,
  priceUnit: 'room-night', basisAssumed: true, url: 'https://example.com/hotel', departureCities: [] };
const quote: Offer = { provider: 'flight', externalId: 'quoted-flight', title: 'Family flight', destination: 'Rome', type: 'flight',
  departureDate: '2027-02-10', returnDate: '2027-02-17', totalMinor: 60000, currency: 'EUR', priceBasis: 'family-total',
  adults: 2, childrenAges: [4, 8], url: 'https://example.com/flight', inclusions: [], swimming: 'unknown', swimmingEvidence: '', checkedAt: now };

test('combined budget accounts for all travelers, selected rooms and full night range', () => {
  const [trip] = combineTrips(criteria, [], [flight, stay]); assert.ok(trip);
  assert.equal(trip.confidence, 'budget-estimate');
  assert.equal(trip.flightTotalMinor, 40000);
  assert.equal(trip.stayTotalMinorMin, 50000); assert.equal(trip.stayTotalMinorMax, 80000);
  assert.equal(trip.totalMinorMin, 90000); assert.equal(trip.totalMinorMax, 120000);
  assert.equal(trip.perPersonMinorMin, 22500); assert.equal(trip.perPersonMinorMax, 30000);
  assert.ok(trip.assumptions.some(a => a.includes('including children')));
  assert.ok(trip.assumptions.some(a => a.includes('room-night rate')));
  assert.equal(trip.departureDate, null);
});
test('unknown return fare gets an explicit two-leg assumption; return fares are not doubled', () => {
  const [trip] = combineTrips(criteria, [], [{ ...flight, journey: 'unknown' }, stay]);
  assert.equal(trip?.flightTotalMinor, 80000);
  assert.ok(trip?.assumptions.some(a => a.includes('2×')));
  assert.equal(combineTrips(criteria, [], [flight, stay])[0]?.flightTotalMinor, 40000);
});
test('components must share destination and currency, and hotel basis must be usable', () => {
  assert.equal(combineTrips(criteria, [], [flight, { ...stay, destination: 'Paris' }]).length, 0);
  assert.equal(combineTrips(criteria, [], [flight, { ...stay, currency: 'USD' }]).length, 0);
  assert.equal(combineTrips(criteria, [], [flight, { ...stay, priceUnit: 'unspecified' }]).length, 0);
  assert.equal(combineTrips({ ...criteria, tripTypes: ['flight'] }, [], [flight, stay]).length, 0);
  assert.equal(combineTrips(criteria, [], [{ ...flight, departureCities: ['Cluj'] }, stay]).length, 0);
});
test('dated flights constrain the stay duration and incompatible or stale components are rejected', () => {
  const dated = { ...flight, departureDates: ['2027-02-10'], nights: 7 };
  const [trip] = combineTrips(criteria, [], [dated, stay]);
  assert.equal(trip?.departureDate, '2027-02-10'); assert.equal(trip?.returnDate, '2027-02-17');
  assert.equal(trip?.minNights, 7); assert.equal(trip?.maxNights, 7);
  assert.equal(combineTrips(criteria, [], [{ ...dated, nights: null }, stay]).length, 0);
  assert.equal(combineTrips(criteria, [], [{ ...dated, departureDates: ['2027-01-01'] }, stay]).length, 0);
  assert.equal(combineTrips(criteria, [], [flight, { ...stay, checkedAt: new Date(Date.now() - 49 * 3600000).toISOString() }]).length, 0);
});
test('date windows must fit the requested stay; budgets respect feasible nights', () => {
  const window = { ...flight, dateWindow: { earliestDeparture: '2027-02-01', latestDeparture: '2027-02-03', earliestReturn: '2027-02-10', latestReturn: '2027-02-11' } };
  const [trip] = combineTrips(criteria, [], [window, stay]);
  assert.equal(trip?.minNights, 7); assert.equal(trip?.maxNights, 8);
  assert.equal(combineTrips(criteria, [], [{ ...window, dateWindow: { ...window.dateWindow, earliestReturn: '2027-02-20', latestReturn: '2027-02-21' } }, stay]).length, 0);
});
test('sum of actual family quotes requires the same party, exact dates and destination', () => {
  const hotel: Offer = { ...quote, provider: 'hotel', externalId: 'quoted-hotel', title: 'Family hotel', destination: 'Roma', type: 'stay', totalMinor: 50000 };
  const [trip] = combineTrips(criteria, [quote, hotel], []);
  assert.equal(trip?.confidence, 'quoted-total'); assert.equal(trip?.totalMinorMin, 110000); assert.equal(trip?.totalMinorMax, 110000);
  assert.equal(combineTrips(criteria, [quote, { ...hotel, childrenAges: [] }], []).length, 0);
  assert.equal(combineTrips(criteria, [quote, { ...hotel, returnDate: '2027-02-18' }], []).length, 0);
  assert.equal(combineTrips(criteria, [quote, { ...hotel, priceBasis: 'indicative' }], []).length, 0);
});
