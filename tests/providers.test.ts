import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchSchema } from '../packages/shared/src/index.js';
import { providers } from '../packages/providers/src/index.js';
import { sourceCatalog } from '../packages/providers/src/catalog.js';
import { createIgnavLiveProvider } from '../packages/providers/src/ignav-live.js';
import { createDuffelLiveProvider } from '../packages/providers/src/duffel-live.js';
import { createSearchApiLiveProvider } from '../packages/providers/src/searchapi-live.js';
import { clearDestinationCityCache, destinationCities, majorDestinationCities } from '../packages/providers/src/destination-cities.js';

const checkedAt = new Date().toISOString();
const criteria = searchSchema.parse({ name: 'Family trip', departure: 'OTP', targetCountry: 'IT', targetCities: ['Rome'], earliestDeparture: '2027-02-01',
  latestReturn: '2027-02-28', minNights: 5, maxNights: 8, adults: 2, childrenAges: [4, 8], tripTypes: ['flight', 'stay', 'package'] });
test('Ignav, flight-only Duffel, and stay-only SearchAPI are advertised and registered', () => {
  assert.deepEqual(sourceCatalog.map(source => source.id), ['ignav', 'duffel', 'searchapi']);
  assert.ok(providers.length <= 3);
  assert.ok(providers.every(provider => ['ignav', 'duffel', 'searchapi'].includes(provider.id)));
});
test('country city lookup ranks by population and limits the automatic selection to five', async () => {
  clearDestinationCityCache();
  const records = [
    { name: 'Small', countryCode: 'IT', population: 10 }, { name: 'Largest', countryCode: 'IT', population: 1000 },
    { name: 'Wrong country', countryCode: 'GR', population: 9999 }, { name: 'Second', countryCode: 'IT', population: 900 },
    { name: 'Third', countryCode: 'IT', population: 800 }, { name: 'Fourth', countryCode: 'IT', population: 700 },
    { name: 'Fifth', countryCode: 'IT', population: 600 }, { name: 'Sixth', countryCode: 'IT', population: 500 },
  ];
  const request: typeof fetch = async () => new Response(JSON.stringify(records), { headers: { 'content-type': 'application/json' } });
  assert.deepEqual((await destinationCities('IT', request)).slice(0, 3), ['Largest', 'Second', 'Third']);
  clearDestinationCityCache();
  assert.deepEqual(await majorDestinationCities('IT', request), ['Largest', 'Second', 'Third', 'Fourth', 'Fifth']);
  clearDestinationCityCache();
});
test('Duffel searches flights only even when the saved search also requests stays', async () => {
  const calls: { url: string; body: any }[] = [];
  const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
  const provider = createDuffelLiveProvider({ accessToken: 'duffel-test-token', appUrl: 'https://travel.example/',
    maxSearches: 1, maxFlightOffers: 1,
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, body });
      if (url.includes('/places/suggestions')) {
        const query = new URL(url).searchParams.get('query');
        return json({ data: [query === 'OTP'
          ? { type: 'airport', iata_code: 'OTP', iata_country_code: 'RO', name: 'Henri Coanda', city_name: 'Bucharest', latitude: 44.57, longitude: 26.08 }
          : { type: 'airport', iata_code: 'FCO', iata_country_code: 'IT', name: 'Fiumicino', city_name: 'Rome', latitude: 41.8, longitude: 12.25 }] });
      }
      if (url.endsWith('/links/sessions')) return json({ data: { url: 'https://links.duffel.com/session-test' } });
      if (url.includes('/air/offer_requests')) return json({ data: { offers: [{ id: 'off_test', total_amount: '400.00', total_currency: 'EUR',
        expires_at: '2099-01-01T00:00:00Z', owner: { name: 'Example Air' }, slices: [
          { segments: [{ marketing_carrier: { iata_code: 'EX' }, marketing_carrier_flight_number: '100' }] },
          { segments: [{ marketing_carrier: { iata_code: 'EX' }, marketing_carrier_flight_number: '101' }] },
        ] }] } });
      return json({ errors: [{ message: `Unexpected test URL ${url}` }] });
    } });
  const offers = await provider.search!(criteria, AbortSignal.timeout(5000));
  assert.deepEqual(offers.map(offer => offer.type), ['flight']);
  assert.equal(offers[0]?.totalMinor, 40000);
  assert.ok(calls.some(call => call.url.includes('/air/offer_requests')));
  assert.ok(!calls.some(call => call.url.includes('/stays/')));
  const session = calls.find(call => call.url.endsWith('/links/sessions'))?.body.data;
  assert.deepEqual({ flights: session.flights.enabled, stays: session.stays.enabled }, { flights: 'true', stays: 'false' });
});
test('Duffel performs no calls for a stay-only saved search', async () => {
  const calls: string[] = [];
  const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
  const provider = createDuffelLiveProvider({ accessToken: 'duffel-test-token', appUrl: 'https://travel.example/', maxSearches: 1,
    fetch: async input => {
      const url = String(input); calls.push(url);
      if (url.includes('/places/suggestions')) return json({ data: [{ type: 'airport', iata_code: url.includes('OTP') ? 'OTP' : 'FCO',
        iata_country_code: url.includes('OTP') ? 'RO' : 'IT', name: 'Airport', city_name: url.includes('OTP') ? 'Bucharest' : 'Rome',
        latitude: 41.8, longitude: 12.25 }] });
      if (url.endsWith('/links/sessions')) return json({ data: { url: 'https://links.duffel.com/session-test' } });
      if (url.includes('/air/offer_requests')) return json({ data: { offers: [] } });
      return json({ errors: [{ message: `Unexpected test URL ${url}` }] });
    } });
  const offers = await provider.search!(searchSchema.parse({ ...criteria, tripTypes: ['stay'] }), AbortSignal.timeout(5000));
  assert.deepEqual(offers, []);
  assert.deepEqual(calls, []);
});
test('SearchAPI returns exact family hotel rates and never invokes its flight engine', async () => {
  const calls: { url: URL; authorization: string }[] = [];
  const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
  const provider = createSearchApiLiveProvider({ apiKey: 'searchapi-test-key', maxSearches: 1, maxProperties: 1,
    fetch: async (input, init) => {
      const url = new URL(String(input));
      calls.push({ url, authorization: new Headers(init?.headers).get('authorization') ?? '' });
      const common = { check_in_date: '2027-02-20', check_out_date: '2027-02-24', currency: 'EUR', adults: 2,
        children_ages: '4,8' };
      if (url.searchParams.get('engine') === 'google_hotels') return json({ search_parameters: { ...common, engine: 'google_hotels' },
        properties: [{ type: 'hotel', property_token: 'property-token', name: 'Family Hotel', city: 'Rome', country: 'IT',
          total_price: { extracted_price: 650.50 } }] });
      if (url.searchParams.get('engine') === 'google_hotels_property') return json({
        search_parameters: { ...common, engine: 'google_hotels_property' }, property: { property_token: 'property-token',
          name: 'Family Hotel', country: 'IT', check_in_date: '2027-02-20', check_out_date: '2027-02-24', currency: 'EUR',
          amenities: ['Breakfast', 'Heated pool'], featured_offers: [], all_offers: [{ source: 'Hotel partner', num_guests: 4,
            total_price: { extracted_price: 650.50 }, link: 'https://hotel.example/exact-family-rate', has_free_cancellation: true }] } });
      return json({ error: 'Unexpected engine' });
    } });
  const offers = await provider.search!(searchSchema.parse({ ...criteria, targetCities: [], targetAirports: ['FCO'],
    earliestDeparture: '2027-02-20', latestReturn: '2027-02-24', minNights: 4, maxNights: 4,
    rooms: 1, tripTypes: ['flight', 'stay'] }), AbortSignal.timeout(5000));
  assert.equal(offers.length, 1);
  assert.equal(offers[0]?.type, 'stay');
  assert.equal(offers[0]?.totalMinor, 65050);
  assert.equal(offers[0]?.destinationAirport, 'FCO');
  assert.equal(offers[0]?.booking?.rooms, 1);
  assert.equal(offers[0]?.swimming, 'heated-pool');
  assert.deepEqual(calls.map(call => call.url.searchParams.get('engine')), ['google_hotels', 'google_hotels_property']);
  assert.ok(calls.every(call => call.authorization === 'Bearer searchapi-test-key'));
  assert.ok(calls.every(call => !call.url.searchParams.has('api_key')));
  assert.ok(calls.every(call => call.url.searchParams.get('engine') !== 'google_flights'));
});
test('SearchAPI declines unsupported hotel occupancies before making a request', async () => {
  const calls: string[] = [];
  const provider = createSearchApiLiveProvider({ apiKey: 'searchapi-test-key', fetch: async input => {
    calls.push(String(input)); return new Response('{}', { headers: { 'content-type': 'application/json' } });
  } });
  const base = { ...criteria, tripTypes: ['stay'] as const };
  assert.deepEqual(await provider.search!(searchSchema.parse({ ...base, rooms: 2 }), AbortSignal.timeout(5000)), []);
  assert.deepEqual(await provider.search!(searchSchema.parse({ ...base, childrenAges: [0] }), AbortSignal.timeout(5000)), []);
  assert.deepEqual(await provider.search!(searchSchema.parse({ ...base, adults: 4, childrenAges: [2, 3, 4] }), AbortSignal.timeout(5000)), []);
  assert.deepEqual(calls, []);
});
test('Ignav scans all default cities, exact-checks candidates, and retains exact full-trip booking links', async () => {
  const requests: { url: string; body: any }[] = [];
  const codes: Record<string, string> = { Rome: 'FCO', Milan: 'MXP', Naples: 'NAP', Turin: 'TRN', Palermo: 'PMO' };
  const provider = createIgnavLiveProvider({ apiKey: 'test-key', maxExactCandidates: 5, maxBookingCandidates: 5,
    airportLookup: async () => Object.entries(codes).map(([city, code]) => ({ code, city, name: `${city} Airport`, country: 'IT' })),
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    requests.push({ url, body });
    if (url.includes('/airports?')) {
      const city = new URL(url).searchParams.get('q')!;
      if (city === 'Bucharest') return new Response(JSON.stringify([
        { code: 'BBU', name: 'Baneasa', city: 'Bucharest', country: 'RO' },
        { code: 'OTP', name: 'Henri Coanda', city: 'Bucharest', country: 'RO' },
      ]), { headers: { 'content-type': 'application/json' } });
      return new Response(JSON.stringify([{ code: codes[city], name: `${city} Airport`, city, country: 'Italy' }]),
        { headers: { 'content-type': 'application/json' } });
    }
    if (url.endsWith('/fares/cheapest-dates')) return new Response(JSON.stringify({ origin: 'OTP', destination: body.destination,
      dates: [{ departure_date: '2027-02-20', return_date: '2027-02-24',
        price: { amount: 350, currency: 'EUR', status: 'unverified' } }], observed_at: checkedAt }),
    { headers: { 'content-type': 'application/json' } });
    const segment = (from: string, to: string, flight: string) => ({ marketing_carrier_code: 'EX', flight_number: flight,
      operating_carrier_name: 'Example Air', departure_airport: from, departure_time_local: '2027-02-20T09:00:00',
      departure_timezone: 'Europe/Bucharest', departure_time_utc: '2027-02-20T07:00:00Z', arrival_airport: to,
      arrival_time_local: '2027-02-20T10:00:00', arrival_timezone: 'Europe/Rome', arrival_time_utc: '2027-02-20T09:00:00Z',
      duration_minutes: 120, aircraft: 'A320' });
    if (url.endsWith('/fares/round-trip')) return new Response(JSON.stringify({ origin: 'OTP', destination: body.destination,
      departure_date: body.departure_date, return_date: body.return_date, observed_at: checkedAt, itineraries: [{
        price: { amount: 400, currency: 'EUR', status: 'verified' }, outbound: { carrier: 'Example Air', duration_minutes: 120,
          segments: [segment('OTP', body.destination, '100')] }, inbound: { carrier: 'Example Air', duration_minutes: 120,
          segments: [segment(body.destination, 'OTP', '101')] }, cabin_class: 'economy', requires_self_transfer: false,
        ignav_id: `quote-${body.destination}` }] }), { headers: { 'content-type': 'application/json' } });
    return new Response(JSON.stringify({ itinerary: { price: { amount: 400, currency: 'EUR', status: 'verified' } },
      booking_options: [
        { legs: ['outbound'], links: [{ provider_name: 'Example Air', provider_type: 'airline',
          price: { amount: 180, currency: 'EUR', status: 'verified' }, url: `https://booking.example/${body.ignav_id}/out` }] },
        { legs: ['inbound'], links: [{ provider_name: 'Example Air', provider_type: 'airline',
          price: { amount: 220, currency: 'EUR', status: 'verified' }, url: `https://booking.example/${body.ignav_id}/back` }] },
      ] }), { headers: { 'content-type': 'application/json' } });
  } });
  const exactCriteria = searchSchema.parse({ ...criteria, departure: 'Bucuresti', targetCities: [], targetAirports: Object.values(codes),
    childrenAges: [1, 4, 14], lapInfants: 1,
    earliestDeparture: '2027-02-20', latestReturn: '2027-02-24', minNights: 4, maxNights: 4, tripTypes: ['flight'] });
  const offers = await provider.search!(exactCriteria, AbortSignal.timeout(5000));
  assert.equal(offers.length, 5); assert.equal(offers[0]?.totalMinor, 40000); assert.equal(offers[0]?.booking?.live, true);
  assert.match(offers[0]?.url ?? '', /^https:\/\/booking\.example\/quote-/);
  assert.equal(offers[0]?.booking?.purchaseLinks?.length, 2);
  assert.match(offers[0]?.booking?.description ?? '', /two separately priced bookings/);
  const scans = requests.filter(value => value.url.endsWith('/fares/cheapest-dates'));
  const exact = requests.filter(value => value.url.endsWith('/fares/round-trip'));
  const links = requests.filter(value => value.url.endsWith('/fares/booking-links'));
  assert.equal(scans.length, 5); assert.equal(exact.length, 5); assert.equal(links.length, 5);
  assert.equal(scans[0]?.body.origin, 'OTP');
  assert.deepEqual(scans[0]?.body.departure_date_range, { start: '2027-02-20', end: '2027-02-20' });
  assert.equal(exact[0]?.body.adults, 3); assert.equal(exact[0]?.body.children, 1);
  assert.equal(exact[0]?.body.infants_in_seat, 0); assert.equal(exact[0]?.body.infants_on_lap, 1);
});
test('Ignav keeps every selected airport: a cheap airport cannot crowd out others, and unlisted codes are still searched', async () => {
  const prices = new Map<string, number>();
  const links: string[] = [];
  const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
  const provider = createIgnavLiveProvider({ apiKey: 'test-key', maxBookingCandidates: 15,
    airportLookup: async () => [{ code: 'FCO', city: 'Rome', name: 'Rome Fiumicino', country: 'IT' }],
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (url.endsWith('/fares/cheapest-dates')) return json({ dates: [{ departure_date: '2027-02-20', return_date: '2027-02-24',
        price: { amount: 100, currency: 'EUR', status: 'unverified' } }] });
      if (url.endsWith('/fares/round-trip')) {
        const amounts = body.destination === 'FCO' ? Array.from({ length: 20 }, (_, index) => 100 + index) : [500];
        return json({ itineraries: amounts.map((amount, index) => {
          prices.set(`${body.destination}-${index}`, amount);
          return { ignav_id: `${body.destination}-${index}`, price: { amount, currency: 'EUR', status: 'verified' },
            outbound: { segments: [{ marketing_carrier_code: 'EX', flight_number: '1' }] },
            inbound: { segments: [{ marketing_carrier_code: 'EX', flight_number: '2' }] } };
        }) });
      }
      links.push(body.ignav_id);
      return json({ itinerary: {}, booking_options: [{ legs: ['outbound', 'inbound'], links: [{ provider_name: 'Example Air',
        price: { amount: prices.get(body.ignav_id), currency: 'EUR', status: 'verified' }, url: `https://booking.example/${body.ignav_id}` }] }] });
    } });
  const offers = await provider.search!(searchSchema.parse({ ...criteria, targetCities: [], targetAirports: ['FCO', 'MXP'],
    earliestDeparture: '2027-02-20', latestReturn: '2027-02-24', minNights: 4, maxNights: 4, tripTypes: ['flight'] }), AbortSignal.timeout(5000));
  assert.deepEqual(offers.map(offer => `${offer.destination}:${offer.totalMinor}`),
    ['Rome Fiumicino (FCO):10000', 'Rome Fiumicino (FCO):10100', 'Rome Fiumicino (FCO):10200', 'MXP (MXP):50000']);
  assert.equal(links.length, 4);
});
