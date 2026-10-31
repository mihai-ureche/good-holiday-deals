import { isSpecificOffer, type Offer, type SearchCriteria } from './index.js';

export type FlightDatePair = {
  departureDate: string;
  returnDate: string;
  nights: number;
};

const dayMs = 24 * 60 * 60 * 1000;
const isoDay = (value: number) => new Date(value).toISOString().slice(0, 10);

// Enumerate by duration first, then departure date. A four-night trip leaving
// on 20 February returns on 24 February; this is the convention used by travel
// suppliers and by the rest of this application.
export function flightDatePairs(criteria: Pick<SearchCriteria,
  'earliestDeparture' | 'latestReturn' | 'minNights' | 'maxNights'>): FlightDatePair[] {
  const first = Date.parse(`${criteria.earliestDeparture}T00:00:00Z`);
  const last = Date.parse(`${criteria.latestReturn}T00:00:00Z`);
  if (!Number.isFinite(first) || !Number.isFinite(last) || first >= last) return [];
  const pairs: FlightDatePair[] = [];
  for (let nights = criteria.minNights; nights <= criteria.maxNights; nights++) {
    for (let departure = first; departure + nights * dayMs <= last; departure += dayMs) {
      pairs.push({ departureDate: isoDay(departure), returnDate: isoDay(departure + nights * dayMs), nights });
    }
  }
  return pairs;
}

export function topFlightOffers<T extends Offer>(offers: T[], limit = 5): T[] {
  return offers.filter(offer => offer.type === 'flight' && roundTripPrice(offer))
    .sort((a, b) => a.totalMinor - b.totalMinor || a.departureDate.localeCompare(b.departureDate)
      || a.returnDate.localeCompare(b.returnDate) || a.provider.localeCompare(b.provider))
    .slice(0, Math.max(0, limit));
}

// Airports are counted per saved search: two searches to the same airport each keep their own top results.
export const flightAirportKey = (offer: Offer & { searchId?: string }) =>
  `${offer.searchId ?? ''}:${offer.destinationAirport ?? offer.destination}`;

export function topFlightOffersPerAirport<T extends Offer & { searchId?: string }>(offers: T[], limit = 3): T[] {
  const counts = new Map<string, number>();
  return offers.filter(offer => offer.type === 'flight' && roundTripPrice(offer))
    .sort((a, b) => a.totalMinor - b.totalMinor || a.departureDate.localeCompare(b.departureDate)
      || a.returnDate.localeCompare(b.returnDate) || a.provider.localeCompare(b.provider))
    .filter(offer => {
      const airport = flightAirportKey(offer);
      const count = counts.get(airport) ?? 0;
      if (count >= Math.max(0, limit)) return false;
      counts.set(airport, count + 1);
      return true;
    });
}

export function roundTripPrice(offer: Offer) {
  if (offer.type !== 'flight' || !isSpecificOffer(offer)) return null;
  const checked = Date.parse(offer.checkedAt);
  if (!Number.isFinite(checked) || checked < Date.now() - 48 * 3600000 || checked > Date.now() + 300000) return null;
  const travelers = offer.adults + offer.childrenAges.length;
  if (travelers < 1 || !Number.isSafeInteger(offer.totalMinor) || offer.totalMinor <= 0) return null;
  return { travelers, totalMinor: offer.totalMinor, perPersonMinor: Math.round(offer.totalMinor / travelers) };
}
