import { matchingOffers, offerSchema, discoverySchema, matchingDiscoveries, type Offer, type Discovery, type SearchCriteria } from '../../shared/src/index.js';
import { sourceCatalog } from './catalog.js';
import { publicPage } from './http.js';
import { parsePublicOffers } from './public-offers.js';
export { sourceCatalog } from './catalog.js';

export interface TravelProvider {
  id: string;
  // Adapters must respect AbortSignal, use a fixed allowlisted origin, and return party-specific quotes.
  search?(criteria: SearchCriteria, signal: AbortSignal): Promise<Offer[]>;
  discover?(criteria: SearchCriteria, signal: AbortSignal): Promise<Discovery[]>;
}

export const providers: TravelProvider[] = sourceCatalog.filter(s => s.mode === 'public-offers').map(source => ({
  id: source.id,
  discover: async (_criteria, signal) => {
    const page = await publicPage(source.url, signal);
    const results = parsePublicOffers(source.id, page.html, page.url, page.checkedAt);
    if (!results.length) throw new Error('The public page did not expose supported offer cards');
    return results;
  },
}));

export async function collect(criteria: SearchCriteria, adapters = providers) {
  const offers: Offer[] = [];
  const discoveries: Discovery[] = [];
  const failures: string[] = [];
  for (const provider of adapters) {
    try {
      const signal = AbortSignal.timeout(30_000);
      const result = provider.search ? await provider.search(criteria, signal) : [];
      offers.push(...result.slice(0, 100).map(v => offerSchema.parse({ ...v, provider: provider.id })));
      if (provider.discover) discoveries.push(...(await provider.discover(criteria, signal)).slice(0, 100)
        .map(v => discoverySchema.parse({ ...v, provider: provider.id })));
    } catch {
      failures.push(provider.id);
    }
  }
  const unique = new Map<string, Offer>();
  for (const offer of matchingOffers(criteria, offers)) unique.set(`${offer.provider}:${offer.externalId}`, offer);
  const leads = new Map<string, Discovery>();
  for (const value of matchingDiscoveries(criteria, discoveries)) leads.set(`${value.provider}:${value.externalId}`, value);
  return { offers: [...unique.values()], discoveries: [...leads.values()], failures, configured: adapters.length };
}
