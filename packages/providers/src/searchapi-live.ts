import { createHash } from 'node:crypto';
import { countryCode, countryName } from '../../shared/src/destinations.js';
import { flightDatePairs, type FlightDatePair } from '../../shared/src/flights.js';
import { offerSchema, type Offer, type SearchCriteria } from '../../shared/src/index.js';
import type { TravelProvider } from './index.js';

const api = 'https://www.searchapi.io/api/v1/search';
type Json = Record<string, unknown>;
type Fetch = typeof fetch;

export type SearchApiLiveOptions = {
  apiKey: string;
  fetch?: Fetch;
  concurrency?: number;
  maxSearches?: number;
  maxProperties?: number;
  maxOffersPerProperty?: number;
};

type StayTarget = { query: string; airport?: string; city?: string };

const object = (value: unknown): Json => value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown) => typeof value === 'string' ? value : '';
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : Number.NaN;

function secureUrl(...values: unknown[]): string | null {
  for (const value of values) {
    const candidate = text(value);
    try { if (candidate && new URL(candidate).protocol === 'https:') return candidate; }
    catch { /* Ignore malformed supplier links. */ }
  }
  return null;
}

function totalMinor(value: unknown): number | null {
  const amount = number(object(value).extracted_price);
  const minor = Math.round(amount * 100);
  return Number.isFinite(amount) && amount > 0 && Number.isSafeInteger(minor) ? minor : null;
}

function sampledPairs(criteria: SearchCriteria, count: number): FlightDatePair[] {
  const pairs = flightDatePairs(criteria);
  if (pairs.length <= count) return pairs;
  if (count <= 1) return pairs.slice(0, Math.max(0, count));
  return Array.from({ length: count }, (_, index) => pairs[Math.round(index * (pairs.length - 1) / (count - 1))]!)
    .filter((pair, index, values) => values.findIndex(other => other.departureDate === pair.departureDate
      && other.returnDate === pair.returnDate) === index);
}

async function concurrentMap<T, R>(values: T[], concurrency: number,
  task: (value: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
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

function responseMatches(body: Json, criteria: SearchCriteria, pair: FlightDatePair): boolean {
  const parameters = object(body.search_parameters);
  return text(parameters.check_in_date) === pair.departureDate
    && text(parameters.check_out_date) === pair.returnDate
    && text(parameters.currency).toUpperCase() === criteria.currency
    && number(parameters.adults) === criteria.adults
    && text(parameters.children_ages) === criteria.childrenAges.join(',');
}

function stayTargets(criteria: SearchCriteria): StayTarget[] {
  const country = countryName(criteria.targetCountry);
  if (criteria.targetAirports.length) return criteria.targetAirports.map(airport => ({
    airport, query: `Hotels near ${airport} airport, ${country}`,
  }));
  if (criteria.targetCities.length) return criteria.targetCities.map(city => ({
    city, query: `Hotels in ${city}, ${country}`,
  }));
  return [{ query: `Hotels in ${country}` }];
}

function offerCandidates(property: Json): Json[] {
  return [...list(property.featured_offers), ...list(property.all_offers)].flatMap(rawOffer => {
    const offer = object(rawOffer);
    const rooms = list(offer.rooms).map(object);
    const roomRates = rooms.flatMap(room => list(room.rates).map(rawRate => ({
      ...offer, ...room, ...object(rawRate), source: offer.source,
      remarks: [...list(offer.remarks), ...list(room.remarks), ...list(object(rawRate).remarks)],
    })));
    return [offer, ...rooms.map(room => ({ ...offer, ...room, source: offer.source })), ...roomRates];
  });
}

function propertyOffers(property: Json, criteria: SearchCriteria, pair: FlightDatePair, target: StayTarget,
  maxOffers: number): Offer[] {
  if (text(property.check_in_date) !== pair.departureDate || text(property.check_out_date) !== pair.returnDate
    || text(property.currency).toUpperCase() !== criteria.currency
    || countryCode(text(property.country)) !== countryCode(criteria.targetCountry)) return [];
  const party = criteria.adults + criteria.childrenAges.length;
  const propertyToken = text(property.property_token);
  const propertyName = text(property.name);
  if (!propertyToken || !propertyName) return [];
  const amenities = list(property.amenities).map(text).filter(Boolean).slice(0, 18);
  const heatedPool = amenities.find(value => /heated[^,;]*pool|pool[^,;]*heated/i.test(value));
  const destination = target.city || text(property.city) || target.airport || countryName(criteria.targetCountry);
  const seen = new Set<string>();
  return offerCandidates(property).flatMap((candidate, index) => {
    const guests = number(candidate.num_guests);
    const price = totalMinor(candidate.total_price);
    const url = secureUrl(candidate.link, candidate.tracking_link);
    const source = text(candidate.source) || 'hotel partner';
    if ((Number.isFinite(guests) && guests !== party) || !price || !url) return [];
    const key = `${source}:${price}:${url}`;
    if (seen.has(key)) return [];
    seen.add(key);
    const remarks = list(candidate.remarks).map(text).filter(Boolean);
    const cancellation = candidate.has_free_cancellation === true ? 'Free cancellation offered' : '';
    const inclusions = [...new Set([...amenities, ...remarks, cancellation].filter(Boolean))].slice(0, 20);
    const reference = createHash('sha256').update(`${propertyToken}:${source}:${url}`).digest('hex').slice(0, 32);
    return [offerSchema.parse({ provider: 'searchapi', externalId: `${reference}-${index}`, title: `${propertyName} · ${source}`,
      destination, ...(target.airport ? { destinationAirport: target.airport } : {}),
      destinationCountry: text(property.country), type: 'stay', departureDate: pair.departureDate,
      returnDate: pair.returnDate, totalMinor: price, currency: criteria.currency, priceBasis: 'family-total',
      adults: criteria.adults, childrenAges: criteria.childrenAges, url,
      booking: { reference, description: `Live Google Hotels rate from ${source} for ${party} guest${party === 1 ? '' : 's'}, `
        + `one room, and the selected dates. Reconfirm room layout, cancellation terms, taxes and availability before payment.`,
      linkKind: 'specific-offer', live: true, rooms: 1,
      purchaseLinks: [{ label: `Book with ${source}`.slice(0, 100), url, totalMinor: price }] },
      inclusions, swimming: heatedPool ? 'heated-pool' : 'unknown', swimmingEvidence: heatedPool ?? '',
      checkedAt: new Date().toISOString() })];
  }).sort((a, b) => a.totalMinor - b.totalMinor).slice(0, maxOffers);
}

export function createSearchApiLiveProvider(options: SearchApiLiveOptions): TravelProvider {
  const request = options.fetch ?? fetch;
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 2, 4));
  const maxSearches = Math.max(1, Math.min(options.maxSearches ?? 5, 15));
  const maxProperties = Math.max(1, Math.min(options.maxProperties ?? 1, 3));
  const maxOffers = Math.max(1, Math.min(options.maxOffersPerProperty ?? 3, 5));

  async function get(parameters: Record<string, string>, signal: AbortSignal): Promise<Json> {
    const url = new URL(api);
    for (const [name, value] of Object.entries(parameters)) if (value) url.searchParams.set(name, value);
    const response = await request(url, { signal, headers: { Authorization: `Bearer ${options.apiKey}`, Accept: 'application/json' } });
    const parsed: unknown = await response.json().catch(() => ({}));
    if (!response.ok) {
      const body = object(parsed);
      throw new Error(`SearchAPI returned ${text(body.error) || text(body.message) || `HTTP ${response.status}`}`);
    }
    return object(parsed);
  }

  async function searchProperties(criteria: SearchCriteria, target: StayTarget, pair: FlightDatePair,
    signal: AbortSignal): Promise<Offer[]> {
    const common = { check_in_date: pair.departureDate, check_out_date: pair.returnDate, currency: criteria.currency,
      adults: String(criteria.adults), children_ages: criteria.childrenAges.join(','), hl: 'en', gl: 'ro' };
    const result = await get({ engine: 'google_hotels', q: target.query, property_type: 'hotel', ...common }, signal);
    if (!responseMatches(result, criteria, pair)) return [];
    const expectedCountry = countryCode(criteria.targetCountry);
    const properties = list(result.properties).map(object).filter(property => text(property.property_token)
      && countryCode(text(property.country)) === expectedCountry)
      .sort((a, b) => (totalMinor(a.total_price) ?? Number.MAX_SAFE_INTEGER)
        - (totalMinor(b.total_price) ?? Number.MAX_SAFE_INTEGER)).slice(0, maxProperties);
    const details = await concurrentMap(properties, concurrency, async property => {
      const detail = await get({ engine: 'google_hotels_property', property_token: text(property.property_token), ...common }, signal);
      if (!responseMatches(detail, criteria, pair)) return [];
      return propertyOffers({ ...property, ...object(detail.property) }, criteria, pair, target, maxOffers);
    });
    return details.filter((value): value is PromiseFulfilledResult<Offer[]> => value.status === 'fulfilled')
      .flatMap(value => value.value);
  }

  return { id: 'searchapi', liveStays: true, timeoutMs: 120_000,
    search: async (criteria, signal) => {
      if (!criteria.tripTypes.includes('stay') || (criteria.rooms ?? 1) !== 1
        || criteria.childrenAges.some(age => age === 0)
        || criteria.adults + criteria.childrenAges.length > 6) return [];
      const targets = stayTargets(criteria);
      const pairsPerTarget = Math.max(1, Math.floor(maxSearches / targets.length));
      const tasks = targets.flatMap(target => sampledPairs(criteria, pairsPerTarget).map(pair => ({ target, pair })))
        .slice(0, maxSearches);
      const results = await concurrentMap(tasks, concurrency,
        ({ target, pair }) => searchProperties(criteria, target, pair, signal));
      const successful = results.filter((value): value is PromiseFulfilledResult<Offer[]> => value.status === 'fulfilled');
      if (!successful.length && results.length) throw new Error('Every SearchAPI hotel search failed');
      return successful.flatMap(value => value.value).sort((a, b) => a.totalMinor - b.totalMinor);
    } };
}
