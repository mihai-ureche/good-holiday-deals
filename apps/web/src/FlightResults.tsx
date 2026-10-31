import { money, type Offer } from '../../../packages/shared/src/index.js';
import { flightAirportKey, roundTripPrice, topFlightOffersPerAirport } from '../../../packages/shared/src/flights.js';
import './flights.css';

const shortDate = (day: string) => `${day.slice(8, 10)}.${day.slice(5, 7)}.${day.slice(0, 4)}`;
const rank = ['Cheapest', '2nd cheapest', '3rd cheapest'];

export function FlightResults({ offers, connected, onSelect }: {
  offers: (Offer & { searchId?: string; searchName?: string })[];
  connected: boolean; onSelect: (offer: Offer) => void;
}) {
  const flights = topFlightOffersPerAirport(offers).flatMap(offer => {
    const price = roundTripPrice(offer);
    return price ? [{ offer, price }] : [];
  });
  // Already sorted by price, so the airport with the cheapest flight is listed first.
  const airports = new Map<string, typeof flights>();
  for (const flight of flights) {
    const key = flightAirportKey(flight.offer);
    airports.set(key, [...(airports.get(key) ?? []), flight]);
  }
  return <section className="flight-results" aria-label="Round-trip flights">
    <h3 className="results-heading">Round-trip flights <span className="count">{flights.length}</span></h3>
    <p className="filter-note">The three cheapest verified variants for each selected airport, found after scanning every matching date pair and exact-checking the strongest candidates. Prices are quoted totals for everyone; per-person prices are averages of that total.</p>
    {!flights.length ? <div className="empty compact">
      <h3>{connected ? 'No matching round-trip quotes.' : 'Live flight pricing is not connected yet.'}</h3>
      <p>{connected ? 'No current round-trip quotes match these dates, travelers and filters.'
        : 'Connect Ignav or Duffel to check return flights and prices for your whole party.'}</p>
    </div> : <div className="flight-airports">{[...airports].map(([key, group]) => <section className="flight-airport" key={key} aria-label={group[0]!.offer.destination}>
      <h4 className="flight-airport-heading">{group[0]!.offer.destination}<small>{group[0]!.offer.searchName ?? group[0]!.offer.provider}</small></h4>
      <div className="flight-list">{group.map(({ offer, price }, index) => <article className="flight-row" key={`${offer.searchId ?? ''}:${offer.provider}:${offer.externalId}`}>
        <div className="flight-route"><h5>{rank[index]}</h5><p>{offer.title}</p></div>
        <p className="flight-date-pair"><span>Out <time dateTime={offer.departureDate}>{shortDate(offer.departureDate)}</time></span>
          <span aria-hidden="true"> – </span><span>In <time dateTime={offer.returnDate}>{shortDate(offer.returnDate)}</time></span></p>
        <div className="flight-price"><strong>{money({ totalMinor: price.perPersonMinor, currency: offer.currency })}<small> each, average</small></strong>
          <span>({money({ totalMinor: price.totalMinor, currency: offer.currency })} total · {price.travelers} travelers)</span></div>
        <div className="flight-actions">{(offer.booking?.purchaseLinks ?? [{ label: 'Open this flight', url: offer.url }]).map(link =>
          <a className="primary" key={link.url} href={link.url} target="_blank" rel="noopener noreferrer">{link.label} ↗</a>)}
          <button type="button" className="text-button" onClick={() => onSelect(offer)}>Flight details</button></div>
      </article>)}</div>
    </section>)}</div>}
  </section>;
}
