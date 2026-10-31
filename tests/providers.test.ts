import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePrice, parsePublicOffers } from '../packages/providers/src/public-offers.js';
import { allowedUrl, clearSourceCache, publicPage } from '../packages/providers/src/http.js';
import { matchingDiscoveries, searchSchema } from '../packages/shared/src/index.js';
import { collect } from '../packages/providers/src/index.js';
import { sourceCatalog } from '../packages/providers/src/catalog.js';
import { createIgnavLiveProvider } from '../packages/providers/src/ignav-live.js';
import { clearDestinationCityCache, destinationCities, majorDestinationCities } from '../packages/providers/src/destination-cities.js';

const checkedAt = new Date().toISOString();
const criteria = searchSchema.parse({ name: 'Family trip', departure: 'OTP', targetCountry: 'IT', targetCities: ['Rome'], earliestDeparture: '2027-02-01',
  latestReturn: '2027-02-28', minNights: 5, maxNights: 8, adults: 2, childrenAges: [4, 8], tripTypes: ['flight', 'stay', 'package'] });
const volaHtml = `<a class="image-grid__item" href="/search_results?from=CITY:BUH&amp;to=CITY:LON&amp;ad=1">
  <span data-testid="image-grid-city">Rome</span><strong>43&nbsp;€</strong></a>`;
const hotelHtml = `<div class="offer"><h4 class="offer-title"><a href="https://romania.directbooking.ro/test-hotel.aspx">Test hotel</a></h4>
  <span class="plain-links">Rome</span><span class="price-from">de la <b>1.234,50 €</b></span></div>`;
const stayHtml = `<div data-price="284.12" data-item-category3="Rome"><a class="list-card__name-link" href="/test-hotel"
  data-urlparams="?adults=2&amp;checkin=2027-02-10&amp;checkout=2027-02-17"><span class="list-card__name">Test stay</span></a>
  <span class="money--muted">474 ron</span><span class="money--primary">285 ron</span><p class="price-block__configuration">2 oaspeți, 7 nopți</p></div>`;
const packageHtml = `<a class="cthw-card-link" href="/sejur-oferte-vacante/test"><span class="cthw-c-type">Sejur</span>
  <span class="cthw-c-dest">Rome</span><span class="cthw-price">de la 1447€ /pers.</span></a>`;

test('Romanian prices retain currency and exact minor units', () => {
  assert.deepEqual(parsePrice('de la 1.234,50 €'), { fromMinor: 123450, currency: 'EUR' });
  assert.deepEqual(parsePrice('285 ron'), { fromMinor: 28500, currency: 'RON' });
  assert.deepEqual(parsePrice('1.234 lei'), { fromMinor: 123400, currency: 'RON' });
  assert.equal(parsePrice('Call for a quote'), null);
  assert.deepEqual(parsePrice('From $1,234.50'), { fromMinor: 123450, currency: 'USD' });
  assert.deepEqual(parsePrice('from £30'), { fromMinor: 3000, currency: 'GBP' });
});
test('published price ranges are rejected rather than truncated into a single price', () => {
  for (const text of ['50–60 €', '€50 - €60', '50 EUR to 60 EUR', '50 € – 60 €']) assert.equal(parsePrice(text), null, text);
  assert.deepEqual(parsePrice('From 50 €'), { fromMinor: 5000, currency: 'EUR' });
});
test('removed sources are not advertised to users', () => {
  assert.equal(sourceCatalog.some(source => String(source.id) === 'paravion'), false);
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
test('requested flight providers retain route, currency, journey and known dates', () => {
  const html = `<a class="c1ucB-content" href="/zboruri/bucuresti/roma"><p class="c1ucB-title">Zboruri din Bucureşti către</p><p class="c1ucB-subtitle">Roma</p><span class="c1ucB-price-container-price">40 €</span></a>`;
  const [momondo] = parsePublicOffers('momondo', html, 'https://www.momondo.ro/zboruri-din-bucuresti', checkedAt);
  assert.equal(momondo?.fromMinor, 4000); assert.equal(momondo?.journey, 'unknown');
  const kiwi = `<a data-test="FlightsFromCityOverhaulResultsCard" aria-label="Rome, Italy" href="/en/search/results/bucharest/rome/2027-02-01_2027-02-03/2027-02-08_2027-02-10/"><p>from £30</p></a>`;
  const [deal] = parsePublicOffers('kiwi', kiwi, 'https://www.kiwi.com/en/city/flights-from-bucharest-romania/', checkedAt);
  assert.equal(deal?.currency, 'GBP'); assert.equal(deal?.journey, 'round-trip'); assert.equal(deal?.dateWindow?.earliestReturn, '2027-02-08');
  assert.equal(deal?.destinationCountry, 'Italy');
  assert.equal(matchingDiscoveries({ ...criteria, currency: 'GBP', targetCountry: 'IT' }, deal ? [deal] : []).length, 1);
  assert.equal(matchingDiscoveries({ ...criteria, currency: 'GBP', targetCountry: 'GR' }, deal ? [deal] : []).length, 0);
  const cf = `<a class="CoTx" href="/flights-to-rome/"><div class="DKKX-main-text">Rome</div><div class="xEtQ-secondary-text">From $40</div></a>`;
  assert.equal(parsePublicOffers('cheapflights', cf, 'https://www.cheapflights.com/flights-from-bucharest/', checkedAt)[0]?.currency, 'USD');
  const sky = `<a class="BrowseListCard_BrowseListCard__card__hash" href="/transport/flights/BUCH/ROM?oym=2702&amp;iym=2702&amp;selectedoday=10&amp;selectediday=17&amp;rtn=1"><span class="BrowseListCard_DestinationTitle__hash">Rome</span><span class="QuoteLink_QuoteLink__hash">De la 160 lei</span></a>`;
  const [skyscanner] = parsePublicOffers('skyscanner', sky, 'https://www.skyscanner.ro/zboruri-de-la/buch/zboruri-ieftine-de-la-bucuresti.html', checkedAt);
  assert.deepEqual(skyscanner?.departureDates, ['2027-02-10']); assert.equal(skyscanner?.nights, 7); assert.equal(skyscanner?.journey, 'round-trip');
  assert.deepEqual(skyscanner?.returnDates, ['2027-02-17']);
});
test('KAYAK groups flights and hotels by destination and exposes assumed hotel basis', () => {
  const html = `<div class="P_Ok-wrapper"><h3 class="P_Ok-title">Roma</h3>
    <a class="P_Ok-sublink-link" href="/zboruri/Bucuresti-OTP/Roma-FCO"><span class="P_Ok-sublink-text">Zborul Bucureşti - Roma (OTP - FCO)</span><span class="P_Ok-sublink-price">≥46 €</span></a>
    <a class="P_Ok-sublink-link" href="/Hoteluri-in-Roma-Test.123.ksp"><span class="P_Ok-sublink-text">Test hotel</span><span class="P_Ok-sublink-price">≥50 €</span></a></div>`;
  const rows = parsePublicOffers('kayak', html, 'https://www.ro.kayak.com/', checkedAt);
  assert.equal(rows.length, 2); assert.equal(rows[0]?.destination, rows[1]?.destination);
  assert.deepEqual(rows[0]?.departureCities, ['Bucureşti']); assert.equal(rows[1]?.priceUnit, 'room-night'); assert.equal(rows[1]?.basisAssumed, true);
});
test('four public layouts produce explicitly unconfirmed leads, not invented family quotes', async () => {
  const inputs = [ ['vola', volaHtml, 'https://www.vola.ro/'], ['directbooking', hotelHtml, 'https://www.directbooking.ro/'],
    ['travelminit', stayHtml, 'https://travelminit.ro/'], ['christiantour', packageHtml, 'https://christiantour.ro/'] ];
  for (const [provider, html, url] of inputs) {
    const results = parsePublicOffers(provider!, html!, url!, checkedAt);
    assert.equal(results.length, 1, provider);
    assert.ok(results[0]!.conditions.includes('confirm'));
    assert.equal('adults' in results[0]!, false, 'requested family composition must never be inferred');
  }
  const vola = parsePublicOffers('vola', volaHtml, 'https://www.vola.ro/', checkedAt)[0]!;
  assert.equal(vola.priceUnit, 'person'); assert.deepEqual(vola.departureDates, []);
  const travelminit = parsePublicOffers('travelminit', stayHtml, 'https://travelminit.ro/', checkedAt)[0]!;
  assert.equal(travelminit.fromMinor, 28500, 'use displayed price, not analytics or crossed-out rate');
  assert.equal(travelminit.nights, 7); assert.deepEqual(travelminit.departureDates, ['2027-02-10']);
  assert.deepEqual(travelminit.returnDates, ['2027-02-17']);
  const propertyLink = new URL(travelminit.url);
  assert.equal(propertyLink.searchParams.get('checkin'), '2027-02-10');
  assert.equal(propertyLink.searchParams.get('checkout'), '2027-02-17');
  assert.equal(propertyLink.searchParams.get('adults'), '2');
  assert.equal(travelminit.linkKind, 'property');
  assert.equal(travelminit.sourceUrl, 'https://travelminit.ro/');
  const result = await collect(criteria, [{ id: 'vola', discover: async () => [vola] }]);
  assert.equal(result.offers.length, 0); assert.equal(result.discoveries.length, 0, 'a flight teaser must never become a result');
});
test('public leads enforce known origins, dates and nights; unknowns remain unconfirmed', () => {
  const flight = parsePublicOffers('vola', volaHtml, 'https://www.vola.ro/', checkedAt)[0]!;
  assert.equal(matchingDiscoveries(criteria, [flight]).length, 1, 'OTP matches Bucharest');
  assert.equal(matchingDiscoveries({ ...criteria, departure: 'Cluj' }, [flight]).length, 0);
  const stay = parsePublicOffers('travelminit', stayHtml, 'https://travelminit.ro/', checkedAt)[0]!;
  const ron = { ...criteria, currency: 'RON' as const };
  assert.equal(matchingDiscoveries(ron, [stay]).length, 1);
  assert.equal(matchingDiscoveries({ ...ron, earliestDeparture: '2027-02-20' }, [stay]).length, 0);
  assert.equal(matchingDiscoveries({ ...ron, minNights: 8, maxNights: 9 }, [stay]).length, 0);
  assert.equal(matchingDiscoveries(criteria, [stay]).length, 0, 'currencies must not be guessed or converted');
});
test('source parsers reject external, unsafe, invalid and duplicate links', () => {
  assert.equal(parsePublicOffers('directbooking', hotelHtml.replace('https://romania.directbooking.ro', 'https://evil.example'), 'https://www.directbooking.ro/', checkedAt).length, 0);
  assert.equal(parsePublicOffers('directbooking', hotelHtml.replace('https://romania.directbooking.ro/test-hotel.aspx', 'javascript:alert(1)'), 'https://www.directbooking.ro/', checkedAt).length, 0);
  assert.equal(parsePublicOffers('directbooking', hotelHtml + hotelHtml, 'https://www.directbooking.ro/', checkedAt).length, 1);
  for (const url of ['http://www.vola.ro/', 'https://www.vola.ro.evil.example/', 'https://127.0.0.1/', 'https://user:pass@www.vola.ro/', 'https://www.vola.ro:123/']) {
    assert.throws(() => allowedUrl(url));
  }
});
test('crawler honors robots exclusions, caches public pages and blocks external redirects', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  try {
    clearSourceCache();
    globalThis.fetch = async () => { calls++; return new Response('User-agent: *\nDisallow: /', { headers: { 'content-type': 'text/plain' } }); };
    await assert.rejects(publicPage('https://www.vola.ro/', AbortSignal.timeout(5000)), /exclude/);
    assert.equal(calls, 1, 'excluded pages must not be fetched');
    clearSourceCache(); calls = 0;
    globalThis.fetch = async url => { calls++; return String(url).endsWith('robots.txt')
      ? new Response('User-agent: *\nAllow: /') : new Response(volaHtml, { headers: { 'content-type': 'text/html' } }); };
    await publicPage('https://travelminit.ro/', AbortSignal.timeout(5000));
    const cached = await publicPage('https://travelminit.ro/', AbortSignal.timeout(5000));
    assert.ok(cached.html.includes('Rome')); assert.equal(calls, 2);
    clearSourceCache();
    globalThis.fetch = async url => String(url).endsWith('robots.txt') ? new Response('User-agent: *\nAllow: /')
      : new Response(null, { status: 302, headers: { Location: 'https://127.0.0.1/private' } });
    await assert.rejects(publicPage('https://christiantour.ro/', AbortSignal.timeout(5000)), /allowed hosts/);
  } finally { globalThis.fetch = original; clearSourceCache(); }
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
