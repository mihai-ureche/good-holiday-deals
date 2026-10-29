import { matchingDiscoveries, matchingOffers, type SearchCriteria, type Discovery, type Offer } from './index.js';
import { destinationKey } from './destinations.js';
export { destinationKey } from './destinations.js';

export type TripComponent = { provider: string; title: string; url: string; checkedAt: string };
export type CombinedTrip = {
  id: string;
  destination: string;
  currency: Offer['currency'];
  confidence: 'quoted-total' | 'budget-estimate';
  flight: TripComponent;
  stay: TripComponent;
  minNights: number;
  maxNights: number;
  rooms: number;
  travelers: number;
  departureDate: string | null;
  returnDate: string | null;
  flightTotalMinor: number;
  stayTotalMinorMin: number;
  stayTotalMinorMax: number;
  totalMinorMin: number;
  totalMinorMax: number;
  perPersonMinorMin: number;
  perPersonMinorMax: number;
  assumptions: string[];
  checkedAt: string;
};

const component = (value: Offer | Discovery): TripComponent => ({ provider: value.provider, title: value.title, url: value.url, checkedAt: value.checkedAt });
const fresh = (value: Offer | Discovery) => Number.isFinite(Date.parse(value.checkedAt))
  && Date.parse(value.checkedAt) >= Date.now() - 48 * 3600000 && Date.parse(value.checkedAt) <= Date.now() + 300000;

export function combineTrips(criteria: SearchCriteria, quotes: Offer[], discoveries: Discovery[]): CombinedTrip[] {
  if (!criteria.tripTypes.includes('flight') || !criteria.tripTypes.includes('stay')) return [];
  const travelers = criteria.adults + criteria.childrenAges.length;
  const rooms = criteria.rooms ?? 1;
  const trips: CombinedTrip[] = [];
  function add(flight: Offer | Discovery, stay: Offer | Discovery, data: Pick<CombinedTrip,
    'confidence' | 'minNights' | 'maxNights' | 'departureDate' | 'returnDate' | 'flightTotalMinor' | 'stayTotalMinorMin' | 'stayTotalMinorMax' | 'assumptions'>) {
    const totalMinorMin = data.flightTotalMinor + data.stayTotalMinorMin;
    const totalMinorMax = data.flightTotalMinor + data.stayTotalMinorMax;
    if (![totalMinorMin, totalMinorMax].every(v => Number.isSafeInteger(v) && v > 0)) return;
    trips.push({ ...data, id: `${data.confidence}:${flight.provider}:${flight.externalId}:${stay.provider}:${stay.externalId}`,
      destination: stay.destination, currency: flight.currency, flight: component(flight), stay: component(stay),
      rooms, travelers, totalMinorMin, totalMinorMax,
      perPersonMinorMin: Math.ceil(totalMinorMin / travelers), perPersonMinorMax: Math.ceil(totalMinorMax / travelers),
      checkedAt: new Date(Math.min(Date.parse(flight.checkedAt), Date.parse(stay.checkedAt))).toISOString() });
  }
  const exact = matchingOffers(criteria, quotes.filter(q => q.priceBasis === 'family-total' && fresh(q)));
  for (const flight of exact.filter(q => q.type === 'flight')) for (const stay of exact.filter(q => q.type === 'stay')) {
    if (destinationKey(flight.destination) !== destinationKey(stay.destination)
      || flight.currency !== stay.currency || flight.departureDate !== stay.departureDate || flight.returnDate !== stay.returnDate) continue;
    const nights = (Date.parse(stay.returnDate) - Date.parse(stay.departureDate)) / 86400000;
    add(flight, stay, { confidence: 'quoted-total', minNights: nights, maxNights: nights,
      departureDate: flight.departureDate, returnDate: flight.returnDate, flightTotalMinor: flight.totalMinor,
      stayTotalMinorMin: stay.totalMinor, stayTotalMinorMax: stay.totalMinor,
      assumptions: ['Sum of two party-specific quotes. Flight and accommodation are booked separately.',
        'Check flight arrival times, airport transfers, room arrangements, inclusions and final availability before booking.'] });
  }
  const leads = matchingDiscoveries(criteria, discoveries.filter(fresh));
  const flights = leads.filter(d => d.type === 'flight' && d.priceUnit === 'person' && d.departureCities.length > 0);
  const stays = leads.filter(d => d.type === 'stay' && d.priceUnit === 'room-night');
  for (const flight of flights) for (const stay of stays) {
    if (destinationKey(flight.destination) !== destinationKey(stay.destination) || flight.currency !== stay.currency) continue;
    // A dated fare must establish the return date; never combine incompatible dated components.
    if (stay.departureDates.length || flight.departureDates.length > 1 || (flight.departureDates.length && flight.nights === null)) continue;
    let minNights = flight.nights ?? criteria.minNights;
    let maxNights = flight.nights ?? criteria.maxNights;
    if (flight.dateWindow) {
      const w = flight.dateWindow;
      const outLow = Math.max(Date.parse(w.earliestDeparture), Date.parse(criteria.earliestDeparture));
      const outHigh = Math.min(Date.parse(w.latestDeparture), Date.parse(criteria.latestReturn));
      const backLow = Date.parse(w.earliestReturn);
      const backHigh = Math.min(Date.parse(w.latestReturn), Date.parse(criteria.latestReturn));
      minNights = Math.max(minNights, Math.ceil((backLow - outHigh) / 86400000));
      maxNights = Math.min(maxNights, Math.floor((backHigh - outLow) / 86400000));
    }
    if (minNights > maxNights) continue;
    const departureDate = flight.departureDates[0] ?? null;
    const returnDate = departureDate ? new Date(Date.parse(departureDate) + minNights * 86400000).toISOString().slice(0, 10) : null;
    const multiplier = flight.journey === 'round-trip' ? 1 : 2;
    const assumptions = [
      'Illustrative budget from public starting prices; availability for your dates and family has not been checked.',
      multiplier === 1 ? 'Uses the advertised return fare per person.' : 'Return fare is not supplied: assumes a return leg costing the same as the advertised fare (2×).',
      `Assumes the same airfare for all ${travelers} travelers, including children; child or infant discounts are not verified.`,
      `Assumes ${rooms} room(s) at the displayed nightly rate for ${minNights}–${maxNights} nights. Room capacity and full-stay price are unverified.`,
      ...(stay.basisAssumed ? ['The source does not state the hotel price basis on this card; treating it as a room-night rate is an explicit budgeting assumption.'] : []),
      'Baggage, transfers, local taxes and other extras may add to the budget. Flights and accommodation are separate bookings.',
    ];
    add(flight, stay, { confidence: 'budget-estimate', minNights, maxNights,
      departureDate, returnDate, flightTotalMinor: flight.fromMinor * multiplier * travelers,
      stayTotalMinorMin: stay.fromMinor * rooms * minNights,
      stayTotalMinorMax: stay.fromMinor * rooms * maxNights, assumptions });
  }
  return trips.sort((a, b) => Number(a.confidence === 'budget-estimate') - Number(b.confidence === 'budget-estimate')
    || a.totalMinorMin - b.totalMinorMin).slice(0, 60);
}
