import { specificOffers, type SearchCriteria, type Discovery, type Offer } from './index.js';
import { destinationKey } from './destinations.js';
export { destinationKey } from './destinations.js';

export type CombinedTrip = {
  id: string;
  destination: string;
  currency: Offer['currency'];
  flight: Offer;
  stay: Offer;
  nights: number;
  rooms: number;
  travelers: number;
  departureDate: string;
  returnDate: string;
  flightTotalMinor: number;
  stayTotalMinor: number;
  totalMinor: number;
  perPersonMinor: number;
  bookingNotes: string[];
  checkedAt: string;
};

export function combineTrips(criteria: SearchCriteria, quotes: Offer[], _discoveries: Discovery[] = []): CombinedTrip[] {
  if (!criteria.tripTypes.includes('flight') || !criteria.tripTypes.includes('stay')) return [];
  const exact = specificOffers(criteria, quotes.filter(q => Date.parse(q.checkedAt) >= Date.now() - 48 * 3600000
    && Date.parse(q.checkedAt) <= Date.now() + 300000));
  const travelers = criteria.adults + criteria.childrenAges.length;
  const trips: CombinedTrip[] = [];
  for (const flight of exact.filter(q => q.type === 'flight')) for (const stay of exact.filter(q => q.type === 'stay')) {
    const sameDestination = flight.destinationAirport && stay.destinationAirport
      ? flight.destinationAirport === stay.destinationAirport
      : destinationKey(flight.destination) === destinationKey(stay.destination);
    if (!sameDestination
      || flight.currency !== stay.currency || flight.departureDate !== stay.departureDate || flight.returnDate !== stay.returnDate) continue;
    const totalMinor = flight.totalMinor + stay.totalMinor;
    if (!Number.isSafeInteger(totalMinor) || totalMinor <= 0) continue;
    trips.push({ id: `quoted:${flight.provider}:${flight.externalId}:${stay.provider}:${stay.externalId}`,
      destination: stay.destination, currency: flight.currency, flight, stay,
      nights: (Date.parse(stay.returnDate) - Date.parse(stay.departureDate)) / 86400000,
      rooms: criteria.rooms ?? 1, travelers, departureDate: flight.departureDate, returnDate: flight.returnDate,
      flightTotalMinor: flight.totalMinor, stayTotalMinor: stay.totalMinor, totalMinor,
      perPersonMinor: Math.ceil(totalMinor / travelers),
      bookingNotes: ['Sum of two party-specific quotes. Flight and accommodation are booked separately.',
        'Check flight arrival times, airport transfers, room arrangements, inclusions and final availability before booking.'],
      checkedAt: new Date(Math.min(Date.parse(flight.checkedAt), Date.parse(stay.checkedAt))).toISOString() });
  }
  return trips.sort((a, b) => a.totalMinor - b.totalMinor).slice(0, 60);
}
