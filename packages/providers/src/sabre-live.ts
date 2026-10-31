import { createHash } from 'node:crypto';
import { countryCode } from '../../shared/src/destinations.js';
import { flightDatePairs, type FlightDatePair } from '../../shared/src/flights.js';
import { offerSchema, type Offer, type SearchCriteria } from '../../shared/src/index.js';
import { destinationCities } from './destination-cities.js';
import type { TravelProvider } from './index.js';

type Json = Record<string, unknown>;
type Fetch = typeof fetch;
type SabreEnvironment = 'cert' | 'production';

export type SabreLiveOptions = {
  userId: string;
  password: string;
  pseudoCityCode: string;
  bookingUrl: string;
  environment?: SabreEnvironment;
  fetch?: Fetch;
  concurrency?: number;
  maxSearches?: number;
  maxFlightOffers?: number;
  maxStayResults?: number;
  stayRadiusKm?: number;
  cityLookup?: (country: string, signal: AbortSignal) => Promise<string[]>;
};

export type SabrePlace = {
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
const apiBase = (environment: SabreEnvironment) => environment === 'production'
  ? 'https://api.platform.sabre.com' : 'https://api.cert.platform.sabre.com';
const tokenCache = new Map<string, { token: string; expiresAt: number }>();
const tokenPending = new Map<string, Promise<string>>();
const placeCache = new Map<string, { expiresAt: number; places: SabrePlace[] }>();

function credentialKey(options: Pick<SabreLiveOptions, 'userId' | 'password' | 'environment'>): string {
  return createHash('sha256').update(`${options.environment ?? 'cert'}\0${options.userId}\0${options.password}`).digest('hex');
}

function validateOptions(options: SabreLiveOptions) {
  if (!/^V1:[^:]+:[^:]+:[^:]+$/.test(options.userId)) throw new Error('SABRE_USER_ID must use the full V1:user:group:domain format');
  if (!/^[A-Za-z0-9]{4}$/.test(options.pseudoCityCode)) throw new Error('SABRE_PCC must be the four-character Sabre pseudo city code');
  if (!options.password) throw new Error('SABRE_PASSWORD is required');
  const url = new URL(options.bookingUrl);
  if (url.protocol !== 'https:') throw new Error('SABRE_BOOKING_URL must use HTTPS');
}

async function responseJson(response: Response, operation: string): Promise<Json> {
  const body: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const parsed = object(body);
    const error = object(parsed.error);
    const detail = text(parsed.message) || text(parsed.error_description) || text(error.message) || `HTTP ${response.status}`;
    throw new Error(`Sabre ${operation} returned ${detail}`);
  }
  return object(body);
}

async function accessToken(options: Pick<SabreLiveOptions, 'userId' | 'password' | 'environment' | 'fetch'>,
  signal: AbortSignal): Promise<string> {
  const key = credentialKey(options);
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt > Date.now() + 120_000) return cached.token;
  const inFlight = tokenPending.get(key);
  if (inFlight) return inFlight;
  const pending = (async () => {
    const encodedUser = Buffer.from(options.userId, 'utf8').toString('base64');
    const encodedPassword = Buffer.from(options.password, 'utf8').toString('base64');
    const basic = Buffer.from(`${encodedUser}:${encodedPassword}`, 'utf8').toString('base64');
    const request = options.fetch ?? fetch;
    const base = apiBase(options.environment ?? 'cert');
    const response = await request(`${base}/v2/auth/token`, { method: 'POST', signal,
      headers: { Authorization: `Basic ${basic}`, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials' }).toString() });
    const body = await responseJson(response, 'authentication');
    const token = text(body.access_token);
    const expiresIn = number(body.expires_in);
    if (!token) throw new Error('Sabre authentication did not return an access token');
    tokenCache.set(key, { token, expiresAt: Date.now() + (Number.isFinite(expiresIn) ? expiresIn : 3600) * 1000 });
    return token;
  })();
  tokenPending.set(key, pending);
  try { return await pending; }
  finally { if (tokenPending.get(key) === pending) tokenPending.delete(key); }
}

async function sabreJson(options: Pick<SabreLiveOptions, 'userId' | 'password' | 'environment' | 'fetch'>,
  path: string, signal: AbortSignal, init: RequestInit = {}): Promise<Json> {
  const token = await accessToken(options, signal);
  const request = options.fetch ?? fetch;
  const response = await request(`${apiBase(options.environment ?? 'cert')}${path}`, { ...init, signal,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers } });
  return responseJson(response, path);
}

function rawPlace(value: unknown): SabrePlace | null {
  const row = object(value);
  const code = text(row.id).toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) return null;
  const latitude = Number(text(row.latitude));
  const longitude = Number(text(row.longitude));
  return { code, name: text(row.name) || code, city: text(row.city) || text(row.name) || code,
    country: text(row.country).toUpperCase(), ...(Number.isFinite(latitude) ? { latitude } : {}),
    ...(Number.isFinite(longitude) ? { longitude } : {}) };
}

async function suggestions(query: string,
  options: Pick<SabreLiveOptions, 'userId' | 'password' | 'environment' | 'fetch'>,
  signal: AbortSignal): Promise<SabrePlace[]> {
  const body = await sabreJson(options, `/v2/geo/autocomplete?query=${encodeURIComponent(query)}&category=AIR&limit=10`, signal);
  const group = object(object(body.grouped)['category:AIR']);
  return list(object(group.doclist).docs).map(rawPlace).filter((place): place is SabrePlace => !!place);
}

async function resolvePlace(query: string, expectedCountry: string,
  options: Pick<SabreLiveOptions, 'userId' | 'password' | 'environment' | 'fetch'>,
  signal: AbortSignal): Promise<SabrePlace> {
  const trimmed = query.trim();
  const code = /^[A-Za-z]{3}$/.test(trimmed) ? trimmed.toUpperCase() : '';
  if (code) return { code, name: code, city: code, country: countryCode(expectedCountry) ?? expectedCountry };
  const places = await suggestions(trimmed, options, signal);
  const country = countryCode(expectedCountry) ?? expectedCountry.toUpperCase();
  const found = places.find(place => !country || place.country === country) ?? (!country ? places[0] : undefined);
  if (!found) throw new Error(`Sabre could not resolve ${trimmed} to an airport${country ? ` in ${country}` : ''}`);
  return found;
}

export async function sabreDestinationAirports(country: string,
  options: Pick<SabreLiveOptions, 'userId' | 'password' | 'environment' | 'fetch'>,
  signal: AbortSignal = AbortSignal.timeout(30_000)): Promise<SabrePlace[]> {
  const code = countryCode(country);
  if (!code) throw new Error('Choose a valid destination country');
  const key = `${options.environment ?? 'cert'}:${code}:${createHash('sha256').update(options.userId).digest('hex').slice(0, 12)}`;
  const cached = placeCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.places.map(place => ({ ...place }));
  const cities = await destinationCities(code, fetch, signal);
  const places: SabrePlace[] = [];
  for (let index = 0; index < cities.length && places.length < 20; index += 5) {
    const batch = await Promise.allSettled(cities.slice(index, index + 5).map(city => suggestions(city, options, signal)));
    for (const result of batch) if (result.status === 'fulfilled') for (const place of result.value) {
      if (place.country === code && !places.some(existing => existing.code === place.code)) places.push(place);
    }
  }
  if (!places.length) throw new Error('Sabre could not resolve airports for the selected country');
  const selected = places.slice(0, 20);
  placeCache.set(key, { expiresAt: Date.now() + 24 * 60 * 60_000, places: selected });
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

function passengerTypes(criteria: SearchCriteria) {
  const quantities = new Map<string, number>();
  quantities.set('ADT', criteria.adults);
  let lapInfants = criteria.lapInfants;
  for (const age of criteria.childrenAges) {
    const code = age < 2 ? (lapInfants-- > 0 ? 'INF' : 'INS') : `C${String(age).padStart(2, '0')}`;
    quantities.set(code, (quantities.get(code) ?? 0) + 1);
  }
  return [...quantities].map(([Code, Quantity]) => ({ Code, Quantity }));
}

function amountMinor(rawAmount: unknown, rawCurrency: unknown, expected: SearchCriteria['currency']): number | null {
  if (text(rawCurrency).toUpperCase() !== expected) return null;
  const amount = typeof rawAmount === 'number' ? rawAmount : Number(text(rawAmount));
  const minor = Math.round(amount * 100);
  return Number.isFinite(amount) && Number.isSafeInteger(minor) && minor > 0 ? minor : null;
}

function handoffUrl(baseUrl: string, values: Record<string, string>): string {
  const url = new URL(baseUrl);
  for (const [key, value] of Object.entries(values)) url.searchParams.set(key, value);
  return url.href;
}

function flightSummary(root: Json, itinerary: Json): string {
  const schedules = new Map(list(root.scheduleDescs).map(value => {
    const row = object(value); return [number(row.id), row] as const;
  }).filter(([id]) => Number.isFinite(id)));
  const legs = new Map(list(root.legDescs).map(value => {
    const row = object(value); return [number(row.id), row] as const;
  }).filter(([id]) => Number.isFinite(id)));
  return list(itinerary.legs).flatMap(rawLeg => {
    const leg = legs.get(number(object(rawLeg).ref));
    return list(leg?.schedules).map(rawSchedule => schedules.get(number(object(rawSchedule).ref))).filter((row): row is Json => !!row)
      .map(row => `${text(object(row.carrier).marketing)}${number(object(row.carrier).marketingFlightNumber)}`);
  }).filter(Boolean).join(' + ');
}

function roomRequest(criteria: SearchCriteria): Json[] | null {
  const rooms = criteria.rooms ?? 1;
  if (criteria.adults < rooms || criteria.adults % rooms || criteria.childrenAges.length % rooms) return null;
  const adults = criteria.adults / rooms;
  const childrenPerRoom = criteria.childrenAges.length / rooms;
  const ages = [...criteria.childrenAges].sort((a, b) => a - b);
  return Array.from({ length: rooms }, (_, index) => {
    const children = ages.slice(index * childrenPerRoom, (index + 1) * childrenPerRoom);
    return { Index: index + 1, Adults: adults, Children: children.length,
      ...(children.length ? { ChildAges: children.join(',') } : {}) };
  });
}

type HotelChoice = { totalMinor: number; rateKeys: string[]; inclusions: string[] };

function hotelChoice(rateInfo: Json, requestedRooms: number, currency: SearchCriteria['currency']): HotelChoice | null {
  const roomGroups = new Map<number, Json[]>();
  for (const rawRoom of list(object(rateInfo.Rooms).Room)) {
    const room = object(rawRoom);
    const index = number(room.RoomIndex);
    if (!Number.isInteger(index)) continue;
    const existing = roomGroups.get(index) ?? [];
    existing.push(room);
    roomGroups.set(index, existing);
  }
  if (roomGroups.size === requestedRooms) {
    let totalMinor = 0;
    const rateKeys: string[] = [];
    const inclusions: string[] = [];
    for (let index = 1; index <= requestedRooms; index++) {
      const choices = (roomGroups.get(index) ?? []).flatMap(room => list(object(room.RatePlans).RatePlan).map(object).flatMap(plan => {
        const converted = object(plan.ConvertedRateInfo);
        const minor = amountMinor(text(converted.ApproxTotalPrice) || text(converted.AmountAfterTax), converted.CurrencyCode, currency);
        const rateKey = text(plan.RateKey);
        if (!minor || !rateKey) return [];
        const meals = object(plan.MealsIncluded);
        const included = list(object(plan.RatePlanInclusions).RatePlanInclusion)
          .map(value => text(object(value).Description)).filter(Boolean);
        if (meals.MealPlanIndicator === true) included.push(text(meals.MealPlanDescription) || 'Meal plan included');
        return [{ minor, rateKey, inclusions: included }];
      })).sort((a, b) => a.minor - b.minor);
      const choice = choices[0];
      if (!choice) return null;
      totalMinor += choice.minor; rateKeys.push(choice.rateKey); inclusions.push(...choice.inclusions);
    }
    return { totalMinor, rateKeys, inclusions: [...new Set(inclusions)].slice(0, 20) };
  }
  if (requestedRooms !== 1) return null;
  const top = list(object(rateInfo.RateInfos).ConvertedRateInfo).map(object).flatMap(rate => {
    const minor = amountMinor(text(rate.ApproxTotalPrice) || text(rate.AmountAfterTax), rate.CurrencyCode, currency);
    const rateKey = text(rate.RateKey);
    return minor && rateKey ? [{ minor, rateKey }] : [];
  }).sort((a, b) => a.minor - b.minor)[0];
  return top ? { totalMinor: top.minor, rateKeys: [top.rateKey], inclusions: [] } : null;
}

export function createSabreLiveProvider(options: SabreLiveOptions): TravelProvider {
  validateOptions(options);
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 2, 4));
  const maxSearches = Math.max(1, Math.min(options.maxSearches ?? 8, 20));
  const maxFlightOffers = Math.max(1, Math.min(options.maxFlightOffers ?? 3, 5));
  const maxStayResults = Math.max(1, Math.min(options.maxStayResults ?? 2, 5));
  const stayRadiusKm = Math.max(1, Math.min(options.stayRadiusKm ?? 30, 320));
  const pcc = options.pseudoCityCode.toUpperCase();

  async function post(path: string, body: unknown, signal: AbortSignal): Promise<Json> {
    return sabreJson(options, path, signal, { method: 'POST', body: JSON.stringify(body) });
  }

  async function flightOffers(criteria: SearchCriteria, origin: SabrePlace, destination: SabrePlace,
    pair: FlightDatePair, signal: AbortSignal): Promise<Offer[]> {
    const response = await post('/v5/offers/shop', { OTA_AirLowFareSearchRQ: { Version: '5', AvailableFlightsOnly: true,
      POS: { Source: [{ PseudoCityCode: pcc, RequestorID: { Type: '1', ID: '1', CompanyName: { Code: 'TN' } } }] },
      OriginDestinationInformation: [
        { RPH: '1', DepartureDateTime: `${pair.departureDate}T00:00:00`, OriginLocation: { LocationCode: origin.code },
          DestinationLocation: { LocationCode: destination.code } },
        { RPH: '2', DepartureDateTime: `${pair.returnDate}T00:00:00`, OriginLocation: { LocationCode: destination.code },
          DestinationLocation: { LocationCode: origin.code } }],
      TravelPreferences: { ValidInterlineTicket: true, CabinPref: [{ Cabin: 'Y', PreferLevel: 'Preferred' }] },
      TravelerInfoSummary: { AirTravelerAvail: [{ PassengerTypeQuantity: passengerTypes(criteria) }],
        PriceRequestInformation: { CurrencyCode: criteria.currency } },
      TPA_Extensions: { IntelliSellTransaction: { RequestType: { Name: '50ITINS' } } } } }, signal);
    const root = object(response.groupedItineraryResponse);
    const checkedAt = new Date().toISOString();
    const expiresAt = new Date(Date.parse(checkedAt) + 30 * 60_000).toISOString();
    const offers = list(root.itineraryGroups).flatMap((rawGroup, groupIndex) => {
      const group = object(rawGroup);
      const descriptions = list(object(group.groupDescription).legDescriptions).map(object);
      if (descriptions.length !== 2 || text(descriptions[0]?.departureDate) !== pair.departureDate
        || text(descriptions[1]?.departureDate) !== pair.returnDate) return [];
      return list(group.itineraries).map(object).flatMap(itinerary => list(itinerary.pricingInformation).map(object).flatMap(pricing => {
        const fare = object(pricing.fare);
        const total = object(fare.totalFare);
        const totalMinor = amountMinor(total.totalPrice, total.currency, criteria.currency);
        if (!totalMinor) return [];
        const reference = createHash('sha256').update(`${origin.code}:${destination.code}:${pair.departureDate}:${pair.returnDate}:`
          + `${groupIndex}:${text(itinerary.id) || number(itinerary.id)}:${text(pricing.pricingSubsource)}:${totalMinor}`).digest('hex').slice(0, 40);
        const summary = flightSummary(root, itinerary);
        const url = handoffUrl(options.bookingUrl, { provider: 'sabre', product: 'flight', reference,
          origin: origin.code, destination: destination.code, departureDate: pair.departureDate, returnDate: pair.returnDate,
          currency: criteria.currency, adults: String(criteria.adults), childrenAges: criteria.childrenAges.join(','),
          lapInfants: String(criteria.lapInfants), itinerary: summary });
        const carrier = text(fare.validatingCarrierCode) || 'Sabre flight';
        return [offerSchema.parse({ provider: 'sabre', externalId: reference,
          title: `${carrier} round trip${summary ? ` · ${summary}` : ''}`, destination: destination.city,
          destinationAirport: destination.code, destinationCountry: criteria.targetCountry, type: 'flight', journey: 'round-trip',
          departureDate: pair.departureDate, returnDate: pair.returnDate, totalMinor, currency: criteria.currency,
          priceBasis: 'family-total', adults: criteria.adults, childrenAges: criteria.childrenAges, url,
          booking: { reference, description: 'Live Sabre Bargain Finder Max quote for the selected party. '
            + 'The configured Sabre booking flow must reprice the itinerary before creating a reservation.',
          linkKind: 'specific-offer', live: true, expiresAt,
          purchaseLinks: [{ label: 'Reprice in the Sabre booking flow', url }] }, inclusions: [], swimming: 'unknown',
          swimmingEvidence: '', checkedAt })];
      }));
    });
    return offers.sort((a, b) => a.totalMinor - b.totalMinor).slice(0, maxFlightOffers);
  }

  async function stayOffers(criteria: SearchCriteria, destination: SabrePlace, pair: FlightDatePair,
    signal: AbortSignal): Promise<Offer[]> {
    const rooms = roomRequest(criteria);
    if (!rooms) return [];
    const country = countryCode(criteria.targetCountry) ?? destination.country;
    const response = await post('/v5/get/hotelavail', { GetHotelAvailRQ: {
      POS: { Source: { PseudoCityCode: pcc } }, SearchCriteria: { OffSet: 1, SortBy: 'AverageNightlyRate', SortOrder: 'ASC',
        PageSize: 10, RateDetailsInd: true,
        GeoSearch: { GeoRef: { Radius: stayRadiusKm, UOM: 'KM', RestrictSearchToCountry: country,
          RefPoint: { Value: destination.code, ValueContext: 'CODE', RefPointType: '6', CountryCode: country } } },
        RateInfoRef: { CurrencyCode: criteria.currency, BestOnly: '1', ConvertedRateInfoOnly: true,
          StayDateTimeRange: { StartDate: pair.departureDate, EndDate: pair.returnDate }, Rooms: { Room: rooms } } } } }, signal);
    const rows = list(object(object(response.GetHotelAvailRS).HotelAvailInfos).HotelAvailInfo).map(object);
    const checkedAt = new Date().toISOString();
    return rows.flatMap(row => {
      const hotel = object(row.HotelInfo);
      const hotelCode = text(hotel.HotelCode);
      const choice = hotelChoice(object(row.HotelRateInfo), criteria.rooms ?? 1, criteria.currency);
      if (!hotelCode || !choice) return [];
      const reference = createHash('sha256').update(`${hotelCode}:${pair.departureDate}:${pair.returnDate}:`
        + choice.rateKeys.join(':')).digest('hex').slice(0, 40);
      const url = handoffUrl(options.bookingUrl, { provider: 'sabre', product: 'stay', reference, hotelCode,
        checkIn: pair.departureDate, checkOut: pair.returnDate, rateKeys: JSON.stringify(choice.rateKeys),
        currency: criteria.currency, adults: String(criteria.adults), childrenAges: criteria.childrenAges.join(','),
        rooms: String(criteria.rooms ?? 1) });
      const location = object(hotel.LocationInfo);
      const address = object(location.Address);
      const name = text(hotel.HotelName) || 'Sabre accommodation';
      return [offerSchema.parse({ provider: 'sabre', externalId: reference, title: name, destination: destination.city,
        destinationAirport: destination.code, destinationCountry: text(object(address.CountryName).Code) || criteria.targetCountry,
        type: 'stay', departureDate: pair.departureDate, returnDate: pair.returnDate, totalMinor: choice.totalMinor,
        currency: criteria.currency, priceBasis: 'family-total', adults: criteria.adults, childrenAges: criteria.childrenAges, url,
        booking: { reference, description: `Live Sabre lodging rate for ${criteria.rooms ?? 1} room(s). `
          + 'The configured Sabre booking flow must run Hotel Price Check before reservation.',
        linkKind: 'specific-offer', rooms: criteria.rooms ?? 1,
        purchaseLinks: [{ label: 'Price-check in the Sabre booking flow', url }] }, inclusions: choice.inclusions,
        swimming: 'unknown', swimmingEvidence: '', checkedAt })];
    }).sort((a, b) => a.totalMinor - b.totalMinor).slice(0, maxStayResults);
  }

  return { id: 'sabre', liveRoundTripFlights: true, liveStays: true, timeoutMs: 300_000,
    search: async (criteria, signal) => {
      const wantsFlight = criteria.tripTypes.includes('flight');
      const wantsStay = criteria.tripTypes.includes('stay');
      if (!wantsFlight && !wantsStay) return [];
      const origin = wantsFlight ? await resolvePlace(criteria.departure, '', options, signal) : null;
      const destinationQueries = criteria.targetAirports.length ? criteria.targetAirports : criteria.targetCities.length
        ? criteria.targetCities : (await (options.cityLookup ?? (async (country, lookupSignal) =>
          (await destinationCities(country, fetch, lookupSignal)).slice(0, 5)))(criteria.targetCountry, signal));
      const resolved = await Promise.allSettled(destinationQueries.map(query => resolvePlace(query, criteria.targetCountry, options, signal)));
      const destinations = resolved.filter((value): value is PromiseFulfilledResult<SabrePlace> => value.status === 'fulfilled')
        .map(value => value.value).filter((value, index, values) => values.findIndex(other => other.code === value.code) === index);
      if (!destinations.length) throw new Error('Sabre could not resolve any selected destination');
      const pairsPerDestination = Math.max(1, Math.floor(maxSearches / destinations.length));
      const pairs = sampledPairs(criteria, pairsPerDestination);
      const tasks = destinations.flatMap(destination => pairs.map(pair => ({ destination, pair }))).slice(0, maxSearches);
      const results = await concurrentMap(tasks, concurrency, async ({ destination, pair }) => {
        const requests: Promise<Offer[]>[] = [];
        if (wantsFlight && origin) requests.push(flightOffers(criteria, origin, destination, pair, signal));
        if (wantsStay) requests.push(stayOffers(criteria, destination, pair, signal));
        const searched = await Promise.allSettled(requests);
        const completed = searched.filter((value): value is PromiseFulfilledResult<Offer[]> => value.status === 'fulfilled');
        if (!completed.length) throw searched.find(value => value.status === 'rejected')?.reason;
        return completed.flatMap(value => value.value);
      });
      const successful = results.filter((value): value is PromiseFulfilledResult<Offer[]> => value.status === 'fulfilled');
      if (!successful.length && results.length) throw new Error('Every Sabre search failed');
      return successful.flatMap(value => value.value).sort((a, b) => a.totalMinor - b.totalMinor);
    } };
}
