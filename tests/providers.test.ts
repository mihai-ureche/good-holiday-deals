import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePrice, parsePublicOffers } from '../packages/providers/src/public-offers.js';
import { allowedUrl, clearSourceCache, publicPage } from '../packages/providers/src/http.js';
import { matchingDiscoveries, searchSchema } from '../packages/shared/src/index.js';
import { collect } from '../packages/providers/src/index.js';

const checkedAt = new Date().toISOString();
const criteria = searchSchema.parse({ name: 'Family trip', departure: 'OTP', earliestDeparture: '2027-02-01',
  latestReturn: '2027-02-28', minNights: 5, maxNights: 8, adults: 2, childrenAges: [4, 8], tripTypes: ['flight', 'stay', 'package'] });
const volaHtml = `<a class="image-grid__item" href="/search_results?from=CITY:BUH&amp;to=CITY:LON&amp;ad=1">
  <span data-testid="image-grid-city">Example city</span><strong>43&nbsp;€</strong></a>`;
const hotelHtml = `<div class="offer"><h4 class="offer-title"><a href="https://romania.directbooking.ro/test-hotel.aspx">Test hotel</a></h4>
  <span class="plain-links">Test resort</span><span class="price-from">de la <b>1.234,50 €</b></span></div>`;
const stayHtml = `<div data-price="284.12" data-item-category3="Test city"><a class="list-card__name-link" href="/test-hotel"
  data-urlparams="?adults=2&amp;checkin=2027-02-10&amp;checkout=2027-02-17"><span class="list-card__name">Test stay</span></a>
  <span class="money--muted">474 ron</span><span class="money--primary">285 ron</span><p class="price-block__configuration">2 oaspeți, 7 nopți</p></div>`;
const packageHtml = `<a class="cthw-card-link" href="/sejur-oferte-vacante/test"><span class="cthw-c-type">Sejur</span>
  <span class="cthw-c-dest">Test island</span><span class="cthw-price">de la 1447€ /pers.</span></a>`;

test('Romanian prices retain currency and exact minor units', () => {
  assert.deepEqual(parsePrice('de la 1.234,50 €'), { fromMinor: 123450, currency: 'EUR' });
  assert.deepEqual(parsePrice('285 ron'), { fromMinor: 28500, currency: 'RON' });
  assert.deepEqual(parsePrice('1.234 lei'), { fromMinor: 123400, currency: 'RON' });
  assert.equal(parsePrice('Call for a quote'), null);
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
  const result = await collect(criteria, [{ id: 'vola', discover: async () => [vola] }]);
  assert.equal(result.offers.length, 0); assert.equal(result.discoveries.length, 1);
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
    assert.ok(cached.html.includes('Example city')); assert.equal(calls, 2);
    clearSourceCache();
    globalThis.fetch = async url => String(url).endsWith('robots.txt') ? new Response('User-agent: *\nAllow: /')
      : new Response(null, { status: 302, headers: { Location: 'https://127.0.0.1/private' } });
    await assert.rejects(publicPage('https://christiantour.ro/', AbortSignal.timeout(5000)), /allowed hosts/);
  } finally { globalThis.fetch = original; clearSourceCache(); }
});
