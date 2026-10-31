import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { countryCode } from '../../shared/src/destinations.js';
import { offerSchema, type Offer, type SearchCriteria } from '../../shared/src/index.js';
import { destinationCities } from './destination-cities.js';
import type { TravelProvider } from './index.js';

const api = 'https://ignav.com/api';
type Json = Record<string, unknown>;
type Fetch = typeof fetch;

export type IgnavLiveOptions = {
  apiKey: string;
  fetch?: Fetch;
  market?: string;
  concurrency?: number;
  maxExactCandidates?: number;
  maxBookingCandidates?: number;
  cityLookup?: (country: string, signal: AbortSignal) => Promise<string[]>;
  airportLookup?: (country: string, signal: AbortSignal) => Promise<IgnavAirport[]>;
};

export type IgnavAirport = { code: string; name: string; city: string; country: string };
type Place = IgnavAirport;
type Candidate = { destination: Place; departureDate: string; returnDate: string; estimatedMinor: number };
type ExactItinerary = Candidate & { itinerary: Json; ignavId: string; exactMinor: number };

const object = (value: unknown): Json => value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown) => typeof value === 'string' ? value : '';
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : Number.NaN;
const dayMs = 86_400_000;
const addDays = (day: string, amount: number) => new Date(Date.parse(`${day}T00:00:00Z`) + amount * dayMs).toISOString().slice(0, 10);
const marketForCurrency: Record<SearchCriteria['currency'], string> = { EUR: 'IE', RON: 'RO', USD: 'US', GBP: 'GB' };
const placeAliases = new Map<string, { query: string; preferredCode?: string }>([
  ['bucharest', { query: 'Bucharest', preferredCode: 'OTP' }],
  ['bucuresti', { query: 'Bucharest', preferredCode: 'OTP' }],
  ['otopeni', { query: 'Bucharest', preferredCode: 'OTP' }],
  ['las palmas de gran canaria', { query: 'Gran Canaria', preferredCode: 'LPA' }],
  ['las palmas', { query: 'Gran Canaria', preferredCode: 'LPA' }],
]);
const normalizedPlace = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const airportCache = new Map<string, { expiresAt: number; airports: IgnavAirport[] }>();

async function resolveAirport(searchTerm: string, expectedCountry: string, apiKey: string, request: Fetch,
  signal: AbortSignal): Promise<IgnavAirport> {
  const trimmed = searchTerm.trim();
  const alias = placeAliases.get(normalizedPlace(trimmed));
  const query = alias?.query ?? trimmed;
  const response = await request(`${api}/airports?q=${encodeURIComponent(query)}&limit=10`, { signal,
    headers: { 'X-Api-Key': apiKey, Accept: 'application/json' } });
  const body: unknown = await response.json().catch(() => []);
  if (!response.ok) throw new Error(`Ignav airport search returned HTTP ${response.status}`);
  const expectedCode = countryCode(expectedCountry);
  const candidates = list(body).map(object).filter(value => /^[A-Za-z]{3}$/.test(text(value.code)));
  const matching = candidates.filter(value => !expectedCode || countryCode(text(value.country)) === expectedCode);
  const found = matching.find(value => text(value.code).toUpperCase() === alias?.preferredCode)
    ?? matching.find(value => normalizedPlace(text(value.city)) === normalizedPlace(query))
    ?? matching[0] ?? (!expectedCode ? candidates[0] : undefined);
  if (!found) throw new Error(`Ignav could not resolve ${trimmed} to an airport in the selected country`);
  return { code: text(found.code).toUpperCase(), name: text(found.name) || `${trimmed} Airport`,
    city: text(found.city) || trimmed, country: countryCode(text(found.country)) ?? text(found.country) };
}

export async function ignavDestinationAirports(country: string, apiKey: string, request: Fetch = fetch,
  signal: AbortSignal = AbortSignal.timeout(30_000)): Promise<IgnavAirport[]> {
  const code = countryCode(country);
  if (!code) throw new Error('Choose a valid destination country');
  const cached = airportCache.get(code);
  if (cached && cached.expiresAt > Date.now()) return cached.airports.map(value => ({ ...value }));
  const cities = await destinationCities(code, fetch, signal);
  const airports: IgnavAirport[] = [];
  for (let index = 0; index < cities.length && airports.length < 20; index += 5) {
    const batch = await Promise.allSettled(cities.slice(index, index + 5)
      .map(city => resolveAirport(city, code, apiKey, request, signal)));
    for (const result of batch) if (result.status === 'fulfilled'
      && !airports.some(airport => airport.code === result.value.code)) airports.push(result.value);
  }
  if (!airports.length) throw new Error('Ignav could not resolve airports for the selected country');
  const selected = airports.slice(0, 20);
  airportCache.set(code, { expiresAt: Date.now() + 24 * 60 * 60_000, airports: selected });
  return selected.map(value => ({ ...value }));
}

function minorPrice(value: unknown, currency: SearchCriteria['currency'], verifiedOnly: boolean): number | null {
  const price = object(value);
  if (text(price.currency).toUpperCase() !== currency || (verifiedOnly && text(price.status) !== 'verified')) return null;
  const minor = Math.round(number(price.amount) * 100);
  return Number.isSafeInteger(minor) && minor > 0 ? minor : null;
}

function passengers(criteria: SearchCriteria) {
  const infants = criteria.childrenAges.filter(age => age < 2).length;
  return {
    adults: criteria.adults + criteria.childrenAges.filter(age => age >= 12).length,
    children: criteria.childrenAges.filter(age => age >= 2 && age < 12).length,
    infants_in_seat: infants - criteria.lapInfants,
    infants_on_lap: criteria.lapInfants,
  };
}

function flightSummary(itinerary: Json): string {
  const summarize = (raw: unknown) => list(object(raw).segments).map(value => {
    const segment = object(value);
    return `${text(segment.marketing_carrier_code)}${text(segment.flight_number)}`.trim();
  }).filter(Boolean).join(' + ');
  return [summarize(itinerary.outbound), summarize(itinerary.inbound)].filter(Boolean).join(' / ');
}

// Keeps the first `limit` values per destination airport of a price-sorted list, so one
// cheap airport cannot use up the request budget of the other selected airports.
function perAirport<T extends { destination: Place }>(limit: number) {
  const counts = new Map<string, number>();
  return (value: T) => {
    const count = counts.get(value.destination.code) ?? 0;
    if (count >= limit) return false;
    counts.set(value.destination.code, count + 1);
    return true;
  };
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

export function createIgnavLiveProvider(options: IgnavLiveOptions): TravelProvider {
  const request = options.fetch ?? fetch;
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 3, 4));
  const maxExactCandidatesPerAirport = Math.max(3, Math.min(options.maxExactCandidates ?? 5, 10));
  const maxBookingCandidates = Math.max(15, Math.min(options.maxBookingCandidates ?? 50, 75));
  const places = new Map<string, Promise<Place>>();

  async function responseJson(response: Response) {
    const body: unknown = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = text(object(body).detail) || text(object(body).message) || `HTTP ${response.status}`;
      throw new Error(`Ignav returned ${detail}`);
    }
    return object(body);
  }

  async function post(path: string, body: unknown, signal: AbortSignal): Promise<Json> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await request(`${api}${path}`, { method: 'POST', signal,
        headers: { 'X-Api-Key': options.apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body) });
      if (response.status !== 424 || attempt === 1) return responseJson(response);
      await delay(250, undefined, { signal });
    }
    throw new Error('Ignav search failed');
  }

  async function place(searchTerm: string, expectedCountry: string, signal: AbortSignal): Promise<Place> {
    const trimmed = searchTerm.trim();
    if (/^[A-Za-z]{3}$/.test(trimmed)) return { code: trimmed.toUpperCase(), name: trimmed.toUpperCase(),
      city: trimmed.toUpperCase(), country: countryCode(expectedCountry) ?? expectedCountry };
    const key = `${expectedCountry}:${trimmed.toLocaleLowerCase()}`;
    let pending = places.get(key);
    if (!pending) {
      pending = resolveAirport(trimmed, expectedCountry, options.apiKey, request, signal);
      places.set(key, pending);
    }
    try { return await pending; } catch (error) { places.delete(key); throw error; }
  }

  async function bookingOffer(criteria: SearchCriteria, exact: ExactItinerary, market: string,
    signal: AbortSignal): Promise<Offer | null> {
    const response = await post('/fares/booking-links', { ignav_id: exact.ignavId }, signal);
    const itinerary = object(response.itinerary);
    const bookingPrice = minorPrice(itinerary.price, criteria.currency, true) ?? exact.exactMinor;
    const options = list(response.booking_options).map(object);
    const usableLinks = (option: Json) => list(option.links).map(object)
      .filter(value => text(value.specificity) !== 'search_results' && text(value.url).startsWith('https://'));
    const combined = options.filter(value => {
      const legs = new Set(list(value.legs).map(text));
      return legs.has('outbound') && legs.has('inbound');
    }).flatMap(usableLinks).map(value => ({ value, minor: minorPrice(value.price, criteria.currency, true) ?? bookingPrice }))
      .sort((a, b) => a.minor - b.minor)[0];
    let purchaseLinks: { label: string; url: string; totalMinor?: number }[];
    let totalMinor: number;
    let provider: string;
    let separateBookings = false;
    if (combined) {
      provider = text(combined.value.provider_name) || 'airline or travel agency';
      totalMinor = combined.minor;
      purchaseLinks = [{ label: `Book with ${provider}`, url: text(combined.value.url), totalMinor }];
    } else {
      const linkFor = (leg: 'outbound' | 'inbound') => options.filter(value => list(value.legs).map(text).includes(leg))
        .flatMap(usableLinks).map(value => ({ value, minor: minorPrice(value.price, criteria.currency, true) }))
        .filter((value): value is { value: Json; minor: number } => value.minor !== null)
        .sort((a, b) => a.minor - b.minor)[0];
      const outbound = linkFor('outbound');
      const inbound = linkFor('inbound');
      if (!outbound || !inbound) return null;
      const outboundProvider = text(outbound.value.provider_name) || 'provider';
      const inboundProvider = text(inbound.value.provider_name) || 'provider';
      totalMinor = outbound.minor + inbound.minor;
      provider = outboundProvider === inboundProvider ? outboundProvider : `${outboundProvider} + ${inboundProvider}`;
      separateBookings = true;
      purchaseLinks = [
        { label: `Book outbound with ${outboundProvider}`, url: text(outbound.value.url), totalMinor: outbound.minor },
        { label: `Book return with ${inboundProvider}`, url: text(inbound.value.url), totalMinor: inbound.minor },
      ];
    }
    const summary = flightSummary(exact.itinerary);
    const checkedAt = new Date().toISOString();
    const expiresAt = new Date(Date.parse(checkedAt) + 30 * 60_000).toISOString();
    const externalId = createHash('sha256').update(`${exact.ignavId}:${purchaseLinks.map(link => link.url).join(':')}`).digest('hex').slice(0, 40);
    return offerSchema.parse({ provider: 'ignav', externalId, title: `${provider} round trip${summary ? ` · ${summary}` : ''}`,
      destination: `${exact.destination.name} (${exact.destination.code})`, destinationAirport: exact.destination.code,
      destinationCountry: criteria.targetCountry,
      type: 'flight', journey: 'round-trip',
      departureDate: exact.departureDate, returnDate: exact.returnDate, totalMinor, currency: criteria.currency,
      priceBasis: 'family-total', adults: criteria.adults, childrenAges: criteria.childrenAges,
      url: purchaseLinks[0]!.url, booking: { reference: exact.ignavId,
        description: `Exact Ignav itinerary for the selected party${summary ? ` (${summary})` : ''}. ${separateBookings
          ? 'The displayed total is the sum of two separately priced bookings; complete both links.'
          : `Recheck the final fare with ${provider}.`}`,
        linkKind: 'specific-offer', live: true, purchaseLinks, expiresAt }, inclusions: [], swimming: 'unknown', swimmingEvidence: '', checkedAt });
  }

  return { id: 'ignav', liveRoundTripFlights: true, timeoutMs: 300_000, search: async (criteria, signal) => {
    if (!criteria.tripTypes.includes('flight')) return [];
    const origin = await place(criteria.departure, '', signal);
    let destinations: Place[];
    if (criteria.targetAirports.length) {
      const available = await (options.airportLookup
        ? options.airportLookup(criteria.targetCountry, signal)
        : ignavDestinationAirports(criteria.targetCountry, options.apiKey, request, signal)).catch(() => [] as IgnavAirport[]);
      // The lookup only supplies display names. A chosen code it no longer lists (cache
      // refresh, transient lookup failure) is still a valid airport, so search it by code.
      destinations = criteria.targetAirports.map(code => available.find(airport => airport.code === code)
        ?? { code, name: code, city: code, country: countryCode(criteria.targetCountry) ?? criteria.targetCountry });
    } else {
      const cityNames = (criteria.targetCities.length ? criteria.targetCities
        : await (options.cityLookup ?? (async (country, lookupSignal) => (await destinationCities(country, fetch, lookupSignal)).slice(0, 5)))
          (criteria.targetCountry, signal)).slice(0, 5);
      const destinationResults = await Promise.allSettled(cityNames.map(city => place(city, criteria.targetCountry, signal)));
      destinations = destinationResults.filter((value): value is PromiseFulfilledResult<Place> => value.status === 'fulfilled')
        .map(value => value.value);
    }
    if (!destinations.length) throw new Error('Ignav could not resolve any selected destination city to an airport');
    const market = options.market ?? marketForCurrency[criteria.currency];
    const party = passengers(criteria);
    const scans = destinations.flatMap(destination => Array.from({ length: criteria.maxNights - criteria.minNights + 1 }, (_, index) => ({
      destination, nights: criteria.minNights + index,
    })));
    const scanResults = await concurrentMap(scans, concurrency, async ({ destination, nights }) => {
      const lastDeparture = addDays(criteria.latestReturn, -nights);
      if (lastDeparture < criteria.earliestDeparture) return [] as Candidate[];
      const response = await post('/fares/cheapest-dates', { origin: origin.code, destination: destination.code,
        departure_date_range: { start: criteria.earliestDeparture, end: lastDeparture }, stay_days: nights,
        ...party, cabin_class: 'economy', market }, signal);
      return list(response.dates).flatMap(value => {
        const row = object(value);
        const departureDate = text(row.departure_date);
        const returnDate = text(row.return_date);
        const estimatedMinor = minorPrice(row.price, criteria.currency, false);
        return estimatedMinor && departureDate >= criteria.earliestDeparture && returnDate <= criteria.latestReturn
          ? [{ destination, departureDate, returnDate, estimatedMinor }] : [];
      });
    });
    const successfulScans = scanResults.filter((value): value is PromiseFulfilledResult<Candidate[]> => value.status === 'fulfilled');
    if (!successfulScans.length) throw new Error('Every Ignav flexible-date scan failed');
    const candidates = successfulScans.flatMap(value => value.value)
      .sort((a, b) => a.estimatedMinor - b.estimatedMinor)
      .filter((value, index, values) => values.findIndex(other => other.destination.code === value.destination.code
        && other.departureDate === value.departureDate && other.returnDate === value.returnDate) === index)
      .filter(perAirport(maxExactCandidatesPerAirport));
    if (!candidates.length) return [];

    const exactResults = await concurrentMap(candidates, concurrency, async candidate => {
      const response = await post('/fares/round-trip', { origin: origin.code, destination: candidate.destination.code,
        departure_date: candidate.departureDate, return_date: candidate.returnDate, ...party,
        cabin_class: 'economy', allow_self_transfer: false, market }, signal);
      return list(response.itineraries).flatMap(value => {
        const itinerary = object(value);
        const ignavId = text(itinerary.ignav_id);
        const exactMinor = minorPrice(itinerary.price, criteria.currency, true);
        return ignavId && exactMinor && list(object(itinerary.outbound).segments).length
          && list(object(itinerary.inbound).segments).length
          ? [{ ...candidate, itinerary, ignavId, exactMinor }] : [];
      });
    });
    const exact = exactResults.filter((value): value is PromiseFulfilledResult<ExactItinerary[]> => value.status === 'fulfilled')
      .flatMap(value => value.value).sort((a, b) => a.exactMinor - b.exactMinor)
      .filter((value, index, values) => values.findIndex(other => other.ignavId === value.ignavId) === index)
      .filter(perAirport(Math.ceil(maxBookingCandidates / destinations.length)));
    const offers: Offer[] = [];
    const offersPerAirport = new Map<string, number>();
    for (const itinerary of exact) {
      if ((offersPerAirport.get(itinerary.destination.code) ?? 0) >= 3) continue;
      try {
        const offer = await bookingOffer(criteria, itinerary, market, signal);
        if (offer) {
          offers.push(offer);
          offersPerAirport.set(itinerary.destination.code, (offersPerAirport.get(itinerary.destination.code) ?? 0) + 1);
        }
      } catch (error) { if (signal.aborted) throw error; }
      if (offers.length >= destinations.length * 3) break;
    }
    return offers.sort((a, b) => a.totalMinor - b.totalMinor);
  } };
}
