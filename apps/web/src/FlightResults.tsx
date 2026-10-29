import { money, type Offer } from '../../../packages/shared/src/index.js';
import { roundTripPrice } from '../../../packages/shared/src/flights.js';
import './flights.css';

const shortDate = (day: string) => `${day.slice(8, 10)}.${day.slice(5, 7)}.${day.slice(0, 4)}`;

export function FlightResults({ offers, connected, onSelect }: {
  offers: (Offer & { searchId?: string; searchName?: string })[];
  connected: boolean; onSelect: (offer: Offer) => void;
}) {
  const flights = offers.flatMap(offer => {
    const price = roundTripPrice(offer);
    return price ? [{ offer, price }] : [];
  });
  return <section className="flight-results" aria-label="Round-trip flights">
    <h3 className="results-heading">Round-trip flights <span className="count">{flights.length}</span></h3>
    <p className="filter-note">Outbound and return dates, with a quoted total for everyone in your search. Per-person prices are averages of that total.</p>
    {!flights.length ? <div className="empty compact">
      <h3>{connected ? 'No matching round-trip quotes.' : 'Live flight pricing is not connected yet.'}</h3>
      <p>{connected ? 'No current round-trip quotes match these dates, travelers and filters.'
        : 'A live flight provider is needed to check return flights and prices for your whole party.'}</p>
    </div> : <div className="flight-list">{flights.map(({ offer, price }) => <article className="flight-row" key={`${offer.searchId ?? ''}:${offer.provider}:${offer.externalId}`}>
      <div className="flight-route"><h4>{offer.destination}</h4><p>{offer.title}</p><small>{offer.searchName ?? offer.provider}</small></div>
      <p className="flight-date-pair"><span>Out <time dateTime={offer.departureDate}>{shortDate(offer.departureDate)}</time></span>
        <span aria-hidden="true"> – </span><span>In <time dateTime={offer.returnDate}>{shortDate(offer.returnDate)}</time></span></p>
      <div className="flight-price"><strong>{money({ totalMinor: price.perPersonMinor, currency: offer.currency })}<small> each, average</small></strong>
        <span>({money({ totalMinor: price.totalMinor, currency: offer.currency })} total · {price.travelers} travelers)</span></div>
      <div className="flight-actions"><a className="primary" href={offer.url} target="_blank" rel="noopener noreferrer">Open this flight ↗</a>
        <button type="button" className="text-button" onClick={() => onSelect(offer)}>Flight details</button></div>
    </article>)}</div>}
  </section>;
}
