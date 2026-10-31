import { countryCode } from '../../shared/src/destinations.js';
import { flightDatePairs, type FlightDatePair } from '../../shared/src/flights.js';
import { offerSchema, type Offer, type SearchCriteria } from '../../shared/src/index.js';
import { destinationCities } from './destination-cities.js';
import type { TravelProvider } from './index.js';

const api = 'https://api.duffel.com';
type Json = Record<string, unknown>;
type Fetch = typeof fetch;

export type DuffelLiveOptions = {
  accessToken: string;
  appUrl: string;
  fetch?: Fetch;
  concurrency?: number;
  maxSearches?: number;
  maxFlightOffers?: number;
  maxStayResults?: number;
  stayRadiusKm?: number;
  cityLookup?: (country: string, signal: AbortSignal) => Promise<string[]>;
};

export type DuffelPlace = {
  code: string;
  name: string;
  city: string;
  country: string;
  latitude?: number;
  longitude?: number;
};

const object = (value: unknown): Json => value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown) => typeof value === 'string' ? value : '';
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : Number.NaN;
const future = (value: string) => Number.isFinite(Date.parse(value)) && Date.parse(value) > Date.now();
const placeCache = new Map<string, { expiresAt: number; places: DuffelPlace[] }>();

function amountMinor(amount: unknown, currency: unknown, expected: SearchCriteria['currency']): number | null {
  if (text(currency).toUpperCase() !== expected || !/^\d+(?:\.\d{1,2})?$/.test(text(amount))) return null;
  const minor = Math.round(Number(text(amount)) * 100);
  return Number.isSafeInteger(minor) && minor > 0 ? minor : null;
}

function rawPlace(value: unknown): DuffelPlace | null {
  const row = object(value);
  const code = text(row.iata_code).toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) return null;
  const latitude = number(row.latitude);
  const longitude = number(row.longitude);
  return { code, name: text(row.name) || code, city: text(row.city_name) || text(object(row.city).name) || text(row.name) || code,
    country: text(row.iata_country_code).toUpperCase(),
    ...(Number.isFinite(latitude) ? { latitude } : {}), ...(Number.isFinite(longitude) ? { longitude } : {}) };
}

function headers(accessToken: string, body = false): HeadersInit {
  return { Authorization: `Bearer ${accessToken}`, 'Duffel-Version': 'v2', Accept: 'application/json',
    'Accept-Encoding': 'gzip', ...(body ? { 'Content-Type': 'application/json' } : {}) };
}

async function responseJson(response: Response): Promise<Json> {
  const parsed: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const body = object(parsed);
    const first = object(list(body.errors)[0]);
    const detail = text(first.message) || text(first.title) || text(body.message) || `HTTP ${response.status}`;
    throw new Error(`Duffel returned ${detail}`);
  }
  return object(parsed);
}

async function suggestions(query: string, accessToken: string, request: Fetch, signal: AbortSignal): Promise<DuffelPlace[]> {
  const response = await request(`${api}/places/suggestions?query=${encodeURIComponent(query)}`, {
    signal, headers: headers(accessToken),
  });
  const body = await responseJson(response);
  return list(body.data).flatMap(value => {
    const row = object(value);
    const direct = text(row.type) === 'airport' ? rawPlace(row) : null;
    const airports = list(row.airports).map(rawPlace).filter((place): place is DuffelPlace => !!place);
    return [...(direct ? [direct] : []), ...airports];
  }).filter((place, index, values) => values.findIndex(other => other.code === place.code) === index);
}

async function resolvePlace(query: string, expectedCountry: string, accessToken: string, request: Fetch,
  signal: AbortSignal, requireCoordinates = false): Promise<DuffelPlace> {
  const places = await suggestions(query, accessToken, request, signal);
  const code = /^[A-Za-z]{3}$/.test(query.trim()) ? query.trim().toUpperCase() : '';
  const country = countryCode(expectedCountry) ?? expectedCountry.toUpperCase();
  const matching = places.filter(place => !country || place.country === country);
  const found = matching.find(place => place.code === code)
    ?? (requireCoordinates ? matching.find(place => place.latitude !== undefined && place.longitude !== undefined) : matching[0])
    ?? (!country ? places[0] : undefined);
  if (!found) throw new Error(`Duffel could not resolve ${query} to a place${country ? ` in ${country}` : ''}`);
  return found;
}

export async function duffelDestinationAirports(country: string, accessToken: string, request: Fetch = fetch,
  signal: AbortSignal = AbortSignal.timeout(30_000)): Promise<DuffelPlace[]> {
  const code = countryCode(country);
  if (!code) throw new Error('Choose a valid destination country');
  const cached = placeCache.get(code);
  if (cached && cached.expiresAt > Date.now()) return cached.places.map(place => ({ ...place }));
  const cities = await destinationCities(code, fetch, signal);
  const places: DuffelPlace[] = [];
  for (let index = 0; index < cities.length && places.length < 20; index += 5) {
    const batch = await Promise.allSettled(cities.slice(index, index + 5)
      .map(city => suggestions(city, accessToken, request, signal)));
    for (const result of batch) if (result.status === 'fulfilled') for (const place of result.value) {
      if (place.country === code && !places.some(existing => existing.code === place.code)) places.push(place);
    }
  }
  if (!places.length) throw new Error('Duffel could not resolve airports for the selected country');
  const selected = places.slice(0, 20);
  placeCache.set(code, { expiresAt: Date.now() + 24 * 60 * 60_000, places: selected });
  return selected.map(place => ({ ...place }));
}

function sampledPairs(criteria: SearchCriteria, count: number): FlightDatePair[] {
  const pairs = flightDatePairs(criteria);
  if (pairs.length <= count) return pairs;
  if (count <= 1) return pairs.slice(0, Math.max(0, count));
  return Array.from({ length: count }, (_, index) => pairs[Math.round(index * (pairs.length - 1) / (count - 1))]!)
    .filter((pair, index, values) => values.findIndex(other => other.departureDate === pair.departureDate
      && other.returnDate === pair.returnDate) === index);
}

async function concurrentMap<T, R>(values: T[], concurrency: number, task: (value: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(values.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (next < values.length) {
      const index = next++;
      try { results[index] = { status: 'fulfilled', value: await task(values[index]!) }; }
      catch (reason) { results[index] = { status: 'rejected', reason }; }
    }
  }));
  return results;
}

function flightSummary(offer: Json): string {
  return list(offer.slices).map(rawSlice => list(object(rawSlice).segments).map(rawSegment => {
    const segment = object(rawSegment);
    const carrier = text(object(segment.marketing_carrier).iata_code);
    return `${carrier}${text(segment.marketing_carrier_flight_number)}`.trim();
  }).filter(Boolean).join(' + ')).filter(Boolean).join(' / ');
}

function rates(accommodation: Json): { room: Json; rate: Json }[] {
  return list(accommodation.rooms).flatMap(rawRoom => {
    const room = object(rawRoom);
    return list(room.rates).map(rawRate => ({ room, rate: object(rawRate) }));
  });
}

function inclusions(rate: Json): string[] {
  const board = text(rate.board_type).replaceAll('_', ' ');
  const benefits = list(rate.benefits).map(value => text(object(value).title)).filter(Boolean);
  return [...new Set([...(board ? [board] : []), ...benefits])].slice(0, 20);
}

export function createDuffelLiveProvider(options: DuffelLiveOptions): TravelProvider {
  const request = options.fetch ?? fetch;
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 2, 4));
  const maxSearches = Math.max(1, Math.min(options.maxSearches ?? 10, 30));
  const maxFlightOffers = Math.max(1, Math.min(options.maxFlightOffers ?? 3, 5));
  const maxStayResults = Math.max(1, Math.min(options.maxStayResults ?? 1, 3));
  const stayRadiusKm = Math.max(1, Math.min(options.stayRadiusKm ?? 20, 100));

  async function post(path: string, data: unknown, signal: AbortSignal): Promise<Json> {
    const response = await request(`${api}${path}`, { method: 'POST', signal, headers: headers(options.accessToken, true),
      body: JSON.stringify({ data }) });
    return responseJson(response);
  }

  async function postEmpty(path: string, signal: AbortSignal): Promise<Json> {
    const response = await request(`${api}${path}`, { method: 'POST', signal, headers: headers(options.accessToken) });
    return responseJson(response);
  }

  async function createBookingLink(criteria: SearchCriteria, wantsFlight: boolean, wantsStay: boolean,
    signal: AbortSignal): Promise<string> {
    const root = new URL(options.appUrl);
    const callback = new URL('/', root).href;
    const response = await post('/links/sessions', { reference: `holiday-${Date.now()}`, success_url: callback,
      failure_url: callback, abandonment_url: callback, traveller_currency: criteria.currency,
      flights: { enabled: String(wantsFlight) }, stays: { enabled: String(wantsStay) } }, signal);
    const data = object(response.data);
    const url = text(data.url) || text(data.link);
    if (!url.startsWith('https://')) throw new Error('Duffel Links did not return a secure hosted booking URL');
    return url;
  }

  async function flightOffers(criteria: SearchCriteria, origin: DuffelPlace, destination: DuffelPlace,
    pair: FlightDatePair, bookingUrl: string, signal: AbortSignal): Promise<Offer[]> {
    const passengers = [
      ...Array.from({ length: criteria.adults }, () => ({ type: 'adult' })),
      ...criteria.childrenAges.map(age => ({ age })),
    ];
    const response = await post('/air/offer_requests?return_offers=true&supplier_timeout=20000&view=offers', {
      slices: [{ origin: origin.code, destination: destination.code, departure_date: pair.departureDate },
        { origin: destination.code, destination: origin.code, departure_date: pair.returnDate }],
      passengers, cabin_class: 'economy',
    }, signal);
    return list(object(response.data).offers).map(object).flatMap(rawOffer => {
      const id = text(rawOffer.id);
      const expiresAt = text(rawOffer.expires_at);
      const totalMinor = amountMinor(rawOffer.total_amount, rawOffer.total_currency, criteria.currency);
      if (!id || !totalMinor || !future(expiresAt) || list(rawOffer.slices).length !== 2) return [];
      const owner = text(object(rawOffer.owner).name) || 'Duffel airline';
      const summary = flightSummary(rawOffer);
      const checkedAt = new Date().toISOString();
      return [offerSchema.parse({ provider: 'duffel', externalId: id, title: `${owner} round trip${summary ? ` · ${summary}` : ''}`,
        destination: destination.city, destinationAirport: destination.code, destinationCountry: criteria.targetCountry,
        type: 'flight', journey: 'round-trip', departureDate: pair.departureDate, returnDate: pair.returnDate,
        totalMinor, currency: criteria.currency, priceBasis: 'family-total', adults: criteria.adults,
        childrenAges: criteria.childrenAges, url: bookingUrl,
        booking: { reference: id, description: `Live Duffel flight offer for the selected party${summary ? ` (${summary})` : ''}. `
          + 'Duffel Links performs a new availability check before purchase, so reconfirm the itinerary and total there.',
        linkKind: 'specific-offer', live: true, expiresAt,
        purchaseLinks: [{ label: 'Recheck and book with Duffel', url: bookingUrl }] },
        inclusions: [], swimming: 'unknown', swimmingEvidence: '', checkedAt })];
    }).sort((a, b) => a.totalMinor - b.totalMinor).slice(0, maxFlightOffers);
  }

  async function stayOffers(criteria: SearchCriteria, destination: DuffelPlace, pair: FlightDatePair,
    bookingUrl: string, signal: AbortSignal): Promise<Offer[]> {
    if (destination.latitude === undefined || destination.longitude === undefined) return [];
    const guests = [...Array.from({ length: criteria.adults }, () => ({ type: 'adult' })),
      ...criteria.childrenAges.map(age => ({ type: 'child', age }))];
    const response = await post('/stays/search', { rooms: criteria.rooms ?? 1, guests,
      check_in_date: pair.departureDate, check_out_date: pair.returnDate,
      location: { radius: stayRadiusKm, geographic_coordinates: { latitude: destination.latitude, longitude: destination.longitude } },
    }, signal);
    const results = list(object(response.data).results).map(object).filter(result => text(result.id) && future(text(result.expires_at)))
      .map(result => ({ result, minor: amountMinor(result.cheapest_rate_total_amount, result.cheapest_rate_currency, criteria.currency) }))
      .filter((value): value is { result: Json; minor: number } => value.minor !== null)
      .sort((a, b) => a.minor - b.minor).slice(0, maxStayResults);
    const offers: Offer[] = [];
    for (const { result } of results) {
      const detailed = object((await postEmpty(`/stays/search_results/${encodeURIComponent(text(result.id))}/actions/fetch_all_rates`, signal)).data);
      const choice = rates(object(detailed.accommodation)).map(value => ({ ...value,
        minor: amountMinor(value.rate.total_amount, value.rate.total_currency, criteria.currency) }))
        .filter((value): value is { room: Json; rate: Json; minor: number } => value.minor !== null && !!text(value.rate.id)
          && (!text(value.rate.expires_at) || future(text(value.rate.expires_at))))
        .sort((a, b) => a.minor - b.minor)[0];
      if (!choice) continue;
      const quote = object((await post('/stays/quotes', { rate_id: text(choice.rate.id) }, signal)).data);
      const totalMinor = amountMinor(quote.total_amount, quote.total_currency, criteria.currency);
      const id = text(quote.id);
      if (!id || !totalMinor) continue;
      const accommodation = object(quote.accommodation);
      const address = object(object(accommodation.location).address);
      const hotel = text(accommodation.name) || 'Duffel accommodation';
      const city = text(address.city_name) || destination.city;
      const checkedAt = new Date().toISOString();
      const expiresAt = text(choice.rate.expires_at) || text(result.expires_at);
      offers.push(offerSchema.parse({ provider: 'duffel', externalId: id, title: hotel,
        destination: city, destinationCountry: text(address.country_code) || criteria.targetCountry,
        type: 'stay', departureDate: text(quote.check_in_date) || pair.departureDate,
        returnDate: text(quote.check_out_date) || pair.returnDate, totalMinor, currency: criteria.currency,
        priceBasis: 'family-total', adults: criteria.adults, childrenAges: criteria.childrenAges, url: bookingUrl,
        booking: { reference: id, description: `Final Duffel stay quote for ${criteria.rooms ?? 1} room(s). `
          + 'Duffel Links performs a new availability check before purchase, so reconfirm the property, rooms and total there.',
        linkKind: 'specific-offer', rooms: criteria.rooms ?? 1, ...(future(expiresAt) ? { expiresAt } : {}),
        purchaseLinks: [{ label: 'Recheck and book with Duffel', url: bookingUrl }] }, inclusions: inclusions(choice.rate),
        swimming: 'unknown', swimmingEvidence: '', checkedAt }));
    }
    return offers;
  }

  return { id: 'duffel', liveRoundTripFlights: true, liveStays: true, timeoutMs: 300_000,
    search: async (criteria, signal) => {
      const wantsFlight = criteria.tripTypes.includes('flight');
      const wantsStay = criteria.tripTypes.includes('stay');
      if (!wantsFlight && !wantsStay) return [];
      const origin = wantsFlight ? await resolvePlace(criteria.departure, '', options.accessToken, request, signal) : null;
      const destinationQueries = criteria.targetAirports.length ? criteria.targetAirports : criteria.targetCities.length
        ? criteria.targetCities : (await (options.cityLookup ?? (async (country, lookupSignal) =>
          (await destinationCities(country, fetch, lookupSignal)).slice(0, 5)))(criteria.targetCountry, signal));
      const destinationResults = await Promise.allSettled(destinationQueries
        .map(value => resolvePlace(value, criteria.targetCountry, options.accessToken, request, signal, wantsStay)));
      const destinations = destinationResults.filter((value): value is PromiseFulfilledResult<DuffelPlace> => value.status === 'fulfilled')
        .map(value => value.value).filter((value, index, values) => values.findIndex(other => other.code === value.code) === index);
      if (!destinations.length) throw new Error('Duffel could not resolve any selected destination');
      const bookingUrl = await createBookingLink(criteria, wantsFlight, wantsStay, signal);
      const pairsPerDestination = Math.max(1, Math.floor(maxSearches / destinations.length));
      const pairs = sampledPairs(criteria, pairsPerDestination);
      const tasks = destinations.flatMap(destination => pairs.map(pair => ({ destination, pair }))).slice(0, maxSearches);
      const results = await concurrentMap(tasks, concurrency, async ({ destination, pair }) => {
        const requests: Promise<Offer[]>[] = [];
        if (wantsFlight && origin) requests.push(flightOffers(criteria, origin, destination, pair, bookingUrl, signal));
        if (wantsStay) requests.push(stayOffers(criteria, destination, pair, bookingUrl, signal));
        const searched = await Promise.allSettled(requests);
        const completed = searched.filter((value): value is PromiseFulfilledResult<Offer[]> => value.status === 'fulfilled');
        if (!completed.length) throw searched.find(value => value.status === 'rejected')?.reason;
        return completed.flatMap(value => value.value);
      });
      const successful = results.filter((value): value is PromiseFulfilledResult<Offer[]> => value.status === 'fulfilled');
      if (!successful.length && results.length) throw new Error('Every Duffel search failed');
      return successful.flatMap(value => value.value).sort((a, b) => a.totalMinor - b.totalMinor);
    } };
}
