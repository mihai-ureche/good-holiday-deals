import { test } from 'node:test';
import assert from 'node:assert/strict';
import { combineTrips } from '../packages/shared/src/combinations.js';
import { specificOffers, searchSchema, type Offer, type Discovery } from '../packages/shared/src/index.js';

const criteria = searchSchema.parse({ name: 'Family holiday', departure: 'Bucharest', targetCountry: 'IT', targetCities: ['Rome'], earliestDeparture: '2027-02-01', latestReturn: '2027-02-28',
  minNights: 5, maxNights: 8, adults: 2, childrenAges: [4, 8], rooms: 2, tripTypes: ['flight', 'stay'], currency: 'EUR' });
const now = new Date().toISOString();
const flight: Discovery = { provider: 'flight', externalId: 'f1', title: 'Flight', destination: 'Rome', type: 'flight', fromMinor: 10000,
  currency: 'EUR', priceUnit: 'person', journey: 'round-trip', url: 'https://example.com/flight', departureCities: ['Bucharest'], departureDates: [], nights: null,
  conditions: 'Advertised fare; verify family availability.', checkedAt: now };
const stay: Discovery = { ...flight, provider: 'hotel', externalId: 'h1', title: 'Hotel', destination: 'Roma', type: 'stay', fromMinor: 5000,
  priceUnit: 'room-night', basisAssumed: true, url: 'https://example.com/hotel', departureCities: [] };
const quote: Offer = { provider: 'flight', externalId: 'quoted-flight', title: 'Family flight', destination: 'Rome', type: 'flight', journey: 'round-trip',
  departureDate: '2027-02-10', returnDate: '2027-02-17', totalMinor: 60000, currency: 'EUR', priceBasis: 'family-total',
  adults: 2, childrenAges: [4, 8], booking: { reference: 'flight-quote-1', live: true, description: 'Flight OTP–FCO, return, quoted for the selected party.', linkKind: 'specific-offer' }, url: 'https://example.com/flight', inclusions: [], swimming: 'unknown', swimmingEvidence: '', checkedAt: now };

test('public promotions never produce a synthetic flight and stay price', () => {
  assert.deepEqual(combineTrips(criteria, [], [flight, stay]), []);
  assert.deepEqual(combineTrips(criteria, [], [{ ...flight, journey: 'unknown' }, stay]), []);
  assert.deepEqual(combineTrips(criteria, [], [{ ...flight, departureDates: ['2027-02-10'], nights: 7 }, stay]), []);
});
test('specific offers require a source quote reference, direct offer link, matching rooms and an unexpired quote', () => {
  assert.equal(specificOffers(criteria, [quote]).length, 1);
  assert.equal(specificOffers(criteria, [{ ...quote, booking: undefined }]).length, 0);
  assert.equal(specificOffers(criteria, [{ ...quote, priceBasis: 'indicative' }]).length, 0);
  assert.equal(specificOffers(criteria, [{ ...quote, booking: { ...quote.booking!, expiresAt: new Date(Date.now() - 1000).toISOString() } }]).length, 0);
  const hotel: Offer = { ...quote, type: 'stay', booking: { ...quote.booking!, rooms: 2 } };
  assert.equal(specificOffers(criteria, [hotel]).length, 1);
  assert.equal(specificOffers(criteria, [{ ...hotel, booking: { ...hotel.booking!, rooms: 1 } }]).length, 0);
  assert.equal(specificOffers(criteria, [{ ...hotel, booking: { ...hotel.booking!, rooms: undefined } }]).length, 0);
});
test('sum of actual family quotes requires the same party, exact dates and destination', () => {
  const hotel: Offer = { ...quote, provider: 'hotel', externalId: 'quoted-hotel', title: 'Family hotel', destination: 'Roma', type: 'stay', totalMinor: 50000, booking: { reference: 'hotel-rate-1', description: 'Hotel room quote, two rooms for all selected travelers.', linkKind: 'specific-offer', rooms: 2 } };
  const [trip] = combineTrips(criteria, [quote, hotel], []);
  assert.equal(trip?.totalMinor, 110000);
  assert.equal(combineTrips(criteria, [quote, { ...hotel, childrenAges: [] }], []).length, 0);
  assert.equal(combineTrips(criteria, [quote, { ...hotel, returnDate: '2027-02-18' }], []).length, 0);
  assert.equal(combineTrips(criteria, [quote, { ...hotel, priceBasis: 'indicative' }], []).length, 0);
  assert.equal(combineTrips(criteria, [quote, { ...hotel, destination: 'Paris' }], []).length, 0);
  const airportCriteria = searchSchema.parse({ ...criteria, targetCities: [], targetAirports: ['FCO'] });
  assert.equal(combineTrips(airportCriteria, [{ ...quote, destination: 'Fiumicino', destinationAirport: 'FCO', destinationCountry: 'IT' },
    { ...hotel, destination: 'Leonardo Da Vinci Airport', destinationAirport: 'FCO', destinationCountry: 'IT' }], []).length, 1);
  assert.equal(combineTrips(airportCriteria, [{ ...quote, destinationAirport: 'FCO', destinationCountry: 'IT' },
    { ...hotel, destinationAirport: 'MXP', destinationCountry: 'IT' }], []).length, 0);
  assert.equal(combineTrips(criteria, [quote, { ...hotel, booking: undefined }], []).length, 0);
  assert.equal(combineTrips(criteria, [{ ...quote, checkedAt: new Date(Date.now() - 49 * 3600000).toISOString() }, hotel], []).length, 0);
  assert.equal(trip?.flight.booking?.reference, 'flight-quote-1');
  assert.equal(trip?.stay.booking?.reference, 'hotel-rate-1');
  assert.equal(trip?.flight.url, quote.url); assert.equal(trip?.stay.url, hotel.url);
});
