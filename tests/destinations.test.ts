import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchingDiscoveries, matchingOffers, searchSchema, type Discovery, type Offer } from '../packages/shared/src/index.js';
import { defaultTargetCities, matchesDestination, selectedTargetCities } from '../packages/shared/src/destinations.js';
import { collect } from '../packages/providers/src/index.js';
import { combineTrips } from '../packages/shared/src/combinations.js';

const criteria = searchSchema.parse({ name: 'Italian destinations', departure: 'Bucharest', targetCountry: 'IT', earliestDeparture: '2027-02-01',
  latestReturn: '2027-02-28', minNights: 5, maxNights: 8, adults: 2, childrenAges: [], tripTypes: ['flight', 'stay', 'package'] });
const flight: Discovery = { provider: 'test', externalId: 'flight', title: 'A flight', destination: 'Roma', type: 'flight',
  fromMinor: 10000, currency: 'EUR', priceUnit: 'person', journey: 'round-trip', url: 'https://example.com/flight',
  departureCities: ['Bucharest'], departureDates: [], nights: null, conditions: 'Dates and family price unconfirmed.', checkedAt: new Date().toISOString() };
const stay: Discovery = { ...flight, externalId: 'stay', destination: 'Rome', type: 'stay', priceUnit: 'room-night', departureCities: [] };
const quote: Offer = { provider: 'test', externalId: 'quote', title: 'A family package', destination: 'Athens', type: 'package',
  departureDate: '2027-02-10', returnDate: '2027-02-17', totalMinor: 100000, currency: 'EUR', priceBasis: 'family-total', booking: { reference: 'test-quote', description: 'Specific package for the selected party and dates.', linkKind: 'specific-offer' },
  adults: 2, childrenAges: [], url: 'https://example.com/package', inclusions: [], swimming: 'unknown', swimmingEvidence: '', checkedAt: new Date().toISOString() };

test('a country is required and an empty city selection is reserved for the backend default', () => {
  assert.deepEqual(criteria.targetCities, []); assert.equal(criteria.targetCountry, 'IT');
  assert.deepEqual(defaultTargetCities('IT'), ['Rome', 'Venice', 'Milan', 'Naples', 'Florence']);
  assert.deepEqual(selectedTargetCities(criteria), []);
  assert.equal(searchSchema.safeParse({ ...criteria, targetCountry: '' }).success, false);
  assert.equal(searchSchema.safeParse({ ...criteria, targetCountry: 'not a country' }).success, false);
  assert.equal(searchSchema.safeParse({ ...criteria, targetCities: ['Rome', 'Venice', 'Milan', 'Naples', 'Florence', 'Bologna'] }).success, false);
  assert.equal(searchSchema.safeParse({ ...criteria, targetCities: ['Athens'] }).success, true);
  assert.equal(searchSchema.safeParse({ ...criteria, targetCities: ['Rome', 'Roma'] }).success, false);
  assert.deepEqual(searchSchema.parse({ ...criteria, targetAirports: ['fco', 'mxp'] }).targetAirports, ['FCO', 'MXP']);
  assert.equal(searchSchema.safeParse({ ...criteria, targetAirports: ['FCO', 'FCO'] }).success, false);
  assert.equal(searchSchema.safeParse({ ...criteria, targetAirports: ['FCO', 'MXP', 'NAP', 'TRN', 'PMO', 'BLQ'] }).success, false);
  assert.equal(searchSchema.safeParse({ ...criteria, targetAirports: ['ROME'] }).success, false);
  assert.deepEqual(searchSchema.parse({ ...criteria, targetCities: undefined, targetCity: 'Rome' }).targetCities, ['Rome']);
});

test('country names, Romanian names and ISO codes match cities and explicitly named countries', () => {
  for (const targetCountry of ['Italy', 'Italia', 'it', ' IT ']) {
    assert.equal(matchesDestination({ targetCountry }, flight), true, targetCountry);
    assert.equal(matchesDestination({ targetCountry }, { destination: 'An unknown village, Italy' }), true);
    assert.equal(matchesDestination({ targetCountry }, { destination: 'Athens' }), false);
    assert.equal(matchesDestination({ targetCountry }, { destination: 'Unidentified resort' }), false);
  }
  assert.equal(matchesDestination({ targetCountry: 'Grecia' }, { destination: 'Creta' }), true);
  assert.equal(matchesDestination({ targetCountry: 'Turcia' }, { destination: 'Antalya' }), true);
  assert.equal(matchesDestination({ targetCountry: 'RO' }, { destination: 'BRAȘOV' }), true);
  assert.equal(matchesDestination({ targetCountry: 'IT' }, { destination: 'Rome, United States' }), false);
  assert.equal(matchesDestination({ targetCountry: 'IT' }, { destination: 'Rome', destinationCountry: 'US' }), false);
  assert.equal(matchesDestination({ targetCountry: 'IT' }, { destination: 'Rome', destinationCountry: 'Unidentified' }), false);
  assert.equal(matchesDestination({ targetCountry: 'TR' }, { destination: 'Antalya - Turcia' }), true);
  assert.equal(matchesDestination({ targetCountry: 'GR' }, { destination: 'Unlisted resort (Greece)' }), true);
});

test('city filters use whole names and aliases; city and country both apply', () => {
  assert.equal(matchesDestination({ targetCities: [' rome '] }, flight), true);
  assert.equal(matchesDestination({ targetCities: ['Rome', 'Venice'], targetCountry: 'Italia' }, { destination: 'Roma, Italia' }), true);
  assert.equal(matchesDestination({ targetCities: ['Rome'], targetCountry: 'GR' }, flight), false);
  assert.equal(matchesDestination({ targetCities: ['Rome'] }, { destination: 'Romeoville' }), false);
  assert.equal(matchesDestination({ targetCities: ['York'] }, { destination: 'New York' }), false);
  assert.equal(matchesDestination({ targetCities: ['Cancún'] }, { destination: 'CANCUN' }), true);
  assert.equal(matchesDestination({ targetCities: ['Atlantis'] }, { destination: 'Atlantis' }), true);
  assert.equal(matchesDestination({ targetCities: ['Rome'] }, { destination: 'Italy' }), false);
});

test('collection filters quotes and public discoveries before saving, including combinations', async () => {
  const target = { ...criteria, targetCountry: 'IT' };
  const result = await collect(target, [{ id: 'test', search: async () => [quote, { ...quote, externalId: 'italy', destination: 'Venice' }],
    discover: async () => [flight, stay, { ...flight, externalId: 'greece', destination: 'Athens' },
      { ...flight, externalId: 'unknown', destination: 'Unknown' }] }]);
  assert.deepEqual(result.offers.map(o => o.externalId), ['italy']);
  assert.deepEqual(result.discoveries.map(o => o.externalId), ['stay']);
  assert.equal(combineTrips(target, [], result.discoveries).length, 0);
  assert.equal(combineTrips({ ...target, targetCities: ['Venice'] }, [], [flight, stay]).length, 0);
  assert.equal(matchingOffers({ ...criteria, targetCountry: 'GR', targetCities: ['Athens'] }, [quote]).length, 1);
  assert.equal(matchingOffers({ ...criteria, targetCities: ['Rome'] }, [quote]).length, 0);
});
