import { specificOffers, offerSchema, discoverySchema, matchingDiscoveries, normalizedCity, type Offer, type Discovery, type SearchCriteria } from '../../shared/src/index.js';
import { sourceCatalog } from './catalog.js';
import { publicPage } from './http.js';
import { parsePublicOffers } from './public-offers.js';
import { createIgnavLiveProvider } from './ignav-live.js';
export { sourceCatalog } from './catalog.js';
export { destinationCities, majorDestinationCities } from './destination-cities.js';
export { createIgnavLiveProvider, ignavDestinationAirports } from './ignav-live.js';

export interface TravelProvider {
  id: string;
  liveRoundTripFlights?: boolean;
  timeoutMs?: number;
  // Adapters must respect AbortSignal, use a fixed allowlisted origin, and return party-specific quotes.
  search?(criteria: SearchCriteria, signal: AbortSignal): Promise<Offer[]>;
  discover?(criteria: SearchCriteria, signal: AbortSignal): Promise<Discovery[]>;
}

const publicProviders: TravelProvider[] = sourceCatalog.filter(s => s.mode === 'public-offers').map(source => ({
  id: source.id,
  discover: async (criteria, signal) => {
    if (['momondo', 'kiwi', 'cheapflights', 'skyscanner'].includes(source.id) && normalizedCity(criteria.departure) !== 'bucuresti') return [];
    const url = 'crawlUrl' in source && typeof source.crawlUrl === 'string' ? source.crawlUrl : source.url;
    const page = await publicPage(url, signal);
    const results = parsePublicOffers(source.id, page.html, page.url, page.checkedAt);
    if (!results.length) throw new Error('The public page did not expose supported offer cards');
    return results;
  },
}));

export const providers: TravelProvider[] = [...publicProviders,
  ...(process.env.IGNAV_API_KEY ? [createIgnavLiveProvider({ apiKey: process.env.IGNAV_API_KEY })] : [])];

export async function collect(criteria: SearchCriteria, adapters = providers) {
  const offers: Offer[] = [];
  const discoveries: Discovery[] = [];
  const failures: string[] = [];
  const includePromotions = criteria.tripTypes.some(type => type !== 'flight');
  for (const provider of adapters) {
    try {
      const signal = AbortSignal.timeout(provider.timeoutMs ?? 30_000);
      const result = provider.search ? await provider.search(criteria, signal) : [];
      offers.push(...result.slice(0, 100).map(v => offerSchema.parse({ ...v, provider: provider.id })));
      if (provider.discover && includePromotions) discoveries.push(...(await provider.discover(criteria, signal)).slice(0, 100)
        .map(v => discoverySchema.parse({ ...v, provider: provider.id })));
    } catch {
      failures.push(provider.id);
    }
  }
  const unique = new Map<string, Offer>();
  for (const offer of specificOffers(criteria, offers)) unique.set(`${offer.provider}:${offer.externalId}`, offer);
  const leads = new Map<string, Discovery>();
  for (const value of matchingDiscoveries(criteria, discoveries).filter(value => value.type !== 'flight')) {
    leads.set(`${value.provider}:${value.externalId}`, value);
  }
  return { offers: [...unique.values()], discoveries: [...leads.values()], failures,
    configured: adapters.filter(provider => provider.search || (includePromotions && provider.discover)).length };
}
