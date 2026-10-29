import { createHash } from 'node:crypto';
import { load } from 'cheerio';
import { discoverySchema, type Discovery } from '../../shared/src/index.js';

const clean = (value: string) => value.replace(/\s+/g, ' ').trim();
export function parsePrice(value: string): { fromMinor: number; currency: Discovery['currency'] } | null {
  const match = value.match(/(\d[\d\s.,]*)\s*(€|EUR\b|RON\b|lei\b)/i);
  if (!match) return null;
  let amount = match[1]!.replace(/\s/g, '');
  if (/^\d{1,3}(?:[.,]\d{3})+$/.test(amount)) amount = amount.replace(/[.,]/g, '');
  else if (amount.includes(',')) amount = amount.replace(/\./g, '').replace(',', '.');
  const fromMinor = Math.round(Number(amount) * 100);
  if (!Number.isSafeInteger(fromMinor) || fromMinor <= 0) return null;
  return { fromMinor, currency: /€|EUR/i.test(match[2]!) ? 'EUR' : 'RON' };
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
  return [...new Map(result.map(r => [r.externalId, r])).values()].slice(0, 60);
}
