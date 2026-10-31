import { specificOffers, offerSchema, discoverySchema, matchingDiscoveries, type Offer, type Discovery, type SearchCriteria } from '../../shared/src/index.js';
import { createIgnavLiveProvider } from './ignav-live.js';
import { createDuffelLiveProvider } from './duffel-live.js';
export { sourceCatalog } from './catalog.js';
export { destinationCities, majorDestinationCities } from './destination-cities.js';
export { createIgnavLiveProvider, ignavDestinationAirports } from './ignav-live.js';
export { createDuffelLiveProvider, duffelDestinationAirports } from './duffel-live.js';

export interface TravelProvider {
  id: string;
  liveRoundTripFlights?: boolean;
  liveStays?: boolean;
  timeoutMs?: number;
  // Adapters must respect AbortSignal, use a fixed allowlisted origin, and return party-specific quotes.
  search?(criteria: SearchCriteria, signal: AbortSignal): Promise<Offer[]>;
  discover?(criteria: SearchCriteria, signal: AbortSignal): Promise<Discovery[]>;
}

export const providers: TravelProvider[] = [
  ...(process.env.IGNAV_API_KEY ? [createIgnavLiveProvider({ apiKey: process.env.IGNAV_API_KEY })] : []),
  ...(process.env.DUFFEL_ACCESS_TOKEN ? [createDuffelLiveProvider({ accessToken: process.env.DUFFEL_ACCESS_TOKEN,
    appUrl: process.env.DUFFEL_LINKS_APP_URL || process.env.APP_URL || 'http://localhost:3000' })] : []),
];

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
