import { matchingOffers, offerSchema, type Offer, type SearchCriteria } from '../../shared/src/index.js';

export interface TravelProvider {
  id: string;
  // Adapters must respect AbortSignal, use a fixed allowlisted origin, and return party-specific quotes.
  search(criteria: SearchCriteria, signal: AbortSignal): Promise<Offer[]>;
}

// Live integrations are added here once provider URLs and access have been assessed.
// No synthetic offers are mixed into live searches.
export const providers: TravelProvider[] = [];

export async function collect(criteria: SearchCriteria, adapters = providers) {
  const offers: Offer[] = [];
  const failures: string[] = [];
  for (const provider of adapters) {
    try {
      const result = await provider.search(criteria, AbortSignal.timeout(45_000));
      offers.push(...result.slice(0, 100).map(v => offerSchema.parse({ ...v, provider: provider.id })));
    } catch {
      failures.push(provider.id);
    }
  }
  const unique = new Map<string, Offer>();
  for (const offer of matchingOffers(criteria, offers)) unique.set(`${offer.provider}:${offer.externalId}`, offer);
  return { offers: [...unique.values()], failures, configured: adapters.length };
}
