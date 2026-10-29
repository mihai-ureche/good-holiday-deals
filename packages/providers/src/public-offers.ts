import { createHash } from 'node:crypto';
import { load } from 'cheerio';
import { discoverySchema, type Discovery } from '../../shared/src/index.js';

const clean = (value: string) => value.replace(/\s+/g, ' ').trim();
export function parsePrice(value: string): { fromMinor: number; currency: Discovery['currency'] } | null {
  const match = value.match(/(?:(€|\$|£)\s*(\d[\d\s.,]*))|(?:(\d[\d\s.,]*)\s*(€|EUR\b|RON\b|lei\b|USD\b|GBP\b|£|\$))/i);
  if (!match) return null;
  const symbol = match[1] ?? match[4]!;
  let amount = (match[2] ?? match[3]!).replace(/\s/g, '');
  if (/^\d{1,3}(?:[.,]\d{3})+$/.test(amount)) amount = amount.replace(/[.,]/g, '');
  else if (amount.includes(',') && amount.includes('.')) amount = amount.lastIndexOf(',') > amount.lastIndexOf('.')
    ? amount.replace(/\./g, '').replace(',', '.') : amount.replace(/,/g, '');
  else if (amount.includes(',')) amount = amount.replace(',', '.');
  const fromMinor = Math.round(Number(amount) * 100);
  if (!Number.isSafeInteger(fromMinor) || fromMinor <= 0) return null;
  return { fromMinor, currency: /€|EUR/i.test(symbol) ? 'EUR' : /\$|USD/i.test(symbol) ? 'USD' : /£|GBP/i.test(symbol) ? 'GBP' : 'RON' };
}

function lead(provider: string, pageUrl: string, checkedAt: string, data: Omit<Discovery, 'provider' | 'externalId' | 'checkedAt'>): Discovery | null {
  try {
    const url = new URL(data.url, pageUrl);
    const base = new URL(pageUrl).hostname.replace(/^www\./, '');
    if (url.protocol !== 'https:' || url.username || url.password || (url.hostname !== base && !url.hostname.endsWith('.' + base))) return null;
    return discoverySchema.parse({ ...data, url: url.href, provider, checkedAt,
      externalId: createHash('sha256').update(url.href).digest('hex').slice(0, 32) });
  } catch { return null; }
}

export function parsePublicOffers(provider: string, html: string, pageUrl: string, checkedAt: string): Discovery[] {
  const $ = load(html);
  const result: Discovery[] = [];
  const add = (data: Omit<Discovery, 'provider' | 'externalId' | 'checkedAt'>) => {
    const value = lead(provider, pageUrl, checkedAt, data); if (value) result.push(value);
  };
  if (provider === 'vola') $('.image-grid__item').each((_, el) => {
    const card = $(el); const price = parsePrice(card.find('strong').text());
    const destination = clean(card.find('[data-testid="image-grid-city"]').text());
    const href = card.attr('href');
    if (!price || !destination || !href) return;
    const link = new URL(href, pageUrl);
    const from = link.searchParams.get('from');
    const cities = from === 'CITY:BUH' ? ['Bucuresti'] : [];
    // Do not infer the origin or fare basis for new site layouts we have not assessed.
    if (!cities.length || link.searchParams.get('ad') !== '1') return;
    add({ ...price, title: `Flight to ${destination}`, destination, type: 'flight', priceUnit: 'person', url: href,
      departureCities: cities, departureDates: [], nights: null,
      conditions: 'Advertised fare for one adult. Travel dates, baggage, child fares and family availability are not confirmed.' });
  });
  if (provider === 'directbooking') $('.offer').each((_, el) => {
    const card = $(el); const link = card.find('.offer-title a').first();
    const price = parsePrice(card.find('.price-from').text());
    const title = clean(link.text()); const href = link.attr('href');
    if (!price || !title || !href) return;
    add({ ...price, title, destination: clean(card.find('.plain-links').text()) || title,
      type: 'stay', priceUnit: 'unspecified', url: href, departureCities: [], departureDates: [], nights: null,
      conditions: 'Advertised hotel starting price. Price basis, dates, duration, transport and family occupancy require confirmation.' });
  });
  if (provider === 'travelminit') $('[data-price]').each((_, el) => {
    const card = $(el); const link = card.find('.list-card__name-link').first();
    const price = parsePrice(card.find('.money--primary').text());
    const title = clean(card.find('.list-card__name').text()); const href = link.attr('href');
    if (!price || !title || !href) return;
    const params = new URLSearchParams(link.attr('data-urlparams') ?? '');
    const checkin = params.get('checkin'); const checkout = params.get('checkout');
    const nights = checkin && checkout ? (Date.parse(checkout) - Date.parse(checkin)) / 86400000 : null;
    const configuration = clean(card.find('.price-block__configuration').text());
    add({ ...price, title, destination: card.attr('data-item-category3') || title,
      type: 'stay', priceUnit: 'advertised-stay', url: href, departureCities: [], departureDates: checkin ? [checkin] : [], nights,
      conditions: `Advertised stay: ${configuration || 'occupancy not confirmed'}. Promotional or membership conditions may apply; your family price is not confirmed.` });
  });
  if (provider === 'christiantour') $('.cthw-card-link').each((_, el) => {
    const card = $(el); const price = parsePrice(card.find('.cthw-price').text());
    const destination = clean(card.find('.cthw-c-dest').text()); const href = card.attr('href');
    if (!price || !destination || !href || clean(card.find('.cthw-c-type').text()).toLowerCase() !== 'sejur') return;
    add({ ...price, title: `Holiday in ${destination}`, destination, type: 'package', priceUnit: 'person', url: href,
      departureCities: [], departureDates: [], nights: null,
      conditions: 'Advertised holiday starting price per person. Departure airport, dates, duration, inclusions and family price are not confirmed.' });
  });
  if (provider === 'momondo') $('.c1ucB-content').each((_, el) => {
    const card = $(el); const price = parsePrice(card.find('.c1ucB-price-container-price').text());
    const destination = clean(card.find('.c1ucB-subtitle').text()); const href = card.attr('href');
    if (!price || !destination || !href || !/bucure[șşs]ti/i.test(card.find('.c1ucB-title').text())) return;
    add({ ...price, title: `Flight to ${destination}`, destination, type: 'flight', priceUnit: 'person', journey: 'unknown', url: href,
      departureCities: ['Bucuresti'], departureDates: [], nights: null,
      conditions: 'Public route starting fare from Bucharest, per person. Travel dates, return fare, baggage and child pricing are not confirmed.' });
  });
  if (provider === 'cheapflights') $('.CoTx').each((_, el) => {
    const card = $(el); const href = card.attr('href');
    if (!href?.startsWith('/flights-to-')) return;
    const price = parsePrice(card.find('.xEtQ-secondary-text').text());
    const destination = clean(card.find('.DKKX-main-text').text());
    if (!price || !destination) return;
    add({ ...price, title: `Flight to ${destination}`, destination, type: 'flight', priceUnit: 'person', journey: 'unknown', url: href,
      departureCities: ['Bucharest'], departureDates: [], nights: null,
      conditions: 'Public route fare from the Bucharest deals page, per person. Dates, return fare and family availability need confirmation. Original source currency retained.' });
  });
  if (provider === 'kayak') $('.P_Ok-wrapper').each((_, el) => {
    const group = $(el); const destination = clean(group.find('.P_Ok-title').first().text());
    if (!destination) return;
    group.find('.P_Ok-sublink-link').each((_, linkEl) => {
      const link = $(linkEl); const href = link.attr('href'); const title = clean(link.find('.P_Ok-sublink-text').text());
      const price = parsePrice(link.find('.P_Ok-sublink-price').text());
      if (!href || !price || !title) return;
      if (href.startsWith('/zboruri/')) {
        const origin = title.match(/^Zbor(?:ul|uri)\s+(.+?)\s+-\s+/i)?.[1];
        if (!origin) return;
        add({ ...price, title, destination, type: 'flight', priceUnit: 'person', journey: 'unknown', url: href,
          departureCities: [origin], departureDates: [], nights: null,
          conditions: 'Advertised route fare per person. Dates, return journey, baggage, transfers and family availability are not confirmed.' });
      } else if (/^\/Hoteluri-in-/.test(href)) {
        add({ ...price, title, destination, type: 'stay', priceUnit: 'room-night', basisAssumed: true, url: href,
          departureCities: [], departureDates: [], nights: null,
          conditions: 'Hotel starting rate treated as one room per night for budget estimation. Nightly basis, room capacity, dates, taxes and full-stay price require confirmation.' });
      }
    });
  });
  if (provider === 'kiwi') $('[data-test="FlightsFromCityOverhaulResultsCard"]').each((_, el) => {
    const card = $(el); const href = card.attr('href'); const title = clean(card.attr('aria-label') ?? '');
    const price = parsePrice(card.find('p').filter((_, el) => /^from\s/i.test(clean($(el).text()))).first().text());
    if (!href || !title || !price) return;
    const windows = [...href.matchAll(/(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})/g)];
    const out = windows[0]; const back = windows[1];
    add({ ...price, title: `Flight to ${title}`, destination: title.split(',')[0]!.trim(), type: 'flight', priceUnit: 'person',
      journey: back ? 'round-trip' : 'unknown', url: href, departureCities: ['Bucharest'], departureDates: [], nights: null,
      ...(out && back ? { dateWindow: { earliestDeparture: out[1]!, latestDeparture: out[2]!, earliestReturn: back[1]!, latestReturn: back[2]! } } : {}),
      conditions: 'Public city-deal fare per person. Advertised date windows may be flexible; exact dates, baggage, child prices and self-transfer conditions require confirmation.' });
  });
  if (provider === 'skyscanner') $('a[class*="BrowseListCard__card"]').each((_, el) => {
    const card = $(el); const href = card.attr('href'); const destination = clean(card.find('[class*="BrowseListCard_DestinationTitle"]').text());
    const price = parsePrice(card.find('[class*="QuoteLink_QuoteLink"]').text());
    if (!href || !destination || !price) return;
    const params = new URL(href, pageUrl).searchParams;
    const date = (ym: string | null, d: string | null) => ym && /^\d{4}$/.test(ym) && d && /^\d{1,2}$/.test(d)
      ? `20${ym.slice(0, 2)}-${ym.slice(2)}-${d.padStart(2, '0')}` : null;
    const out = date(params.get('oym'), params.get('selectedoday'));
    const back = date(params.get('iym'), params.get('selectediday'));
    const nights = out && back ? (Date.parse(back) - Date.parse(out)) / 86400000 : null;
    add({ ...price, title: `Flight to ${destination}`, destination, type: 'flight', priceUnit: 'person',
      journey: params.get('rtn') === '1' ? 'round-trip' : 'unknown', url: href, departureCities: ['Bucharest'],
      departureDates: out ? [out] : [], nights,
      conditions: 'Public landing-page fare per person for the advertised dates. Family availability, baggage and final provider price require confirmation. Transport search endpoints are not crawled.' });
  });
  return [...new Map(result.map(r => [r.externalId, r])).values()].slice(0, 300);
}
