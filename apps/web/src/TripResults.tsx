import React, { useState } from 'react';
import { money } from '../../../packages/shared/src/index.js';
import type { Offer } from '../../../packages/shared/src/index.js';
import type { CombinedTrip } from '../../../packages/shared/src/combinations.js';

export type ListedTrip = CombinedTrip & { searchId: string; searchName: string };
export function TripResults({ trips, sort, onSelect }: { trips: ListedTrip[]; sort: string; onSelect: (offer: Offer) => void }) {
  const [basis, setBasis] = useState('total');
  const [limit, setLimit] = useState(12);
  const price = (t: ListedTrip) => basis === 'total' ? t.totalMinor : t.perPersonMinor;
  const sorted = [...trips].sort((a, b) => (sort === 'asc' ? 1 : -1) * (price(a) - price(b)));
  return <section className="trip-results" aria-label="Flight and accommodation combinations">
    <div className="advertised-heading"><div><h3 className="results-heading">Flight + accommodation <span className="count">{trips.length}</span></h3>
      <p className="filter-note">Two specific quotes with matching dates and travelers. One total price; flight and accommodation are booked separately.</p></div>
      <label>Show prices<select value={basis} onChange={e => setBasis(e.target.value)}><option value="total">Total for all travelers</option><option value="person">Average per person</option></select></label></div>
    {!trips.length ? <div className="empty compact"><h3>No flight + stay combinations yet.</h3><p>A combination needs a specific flight quote and room quote for matching dates and travelers. Public promotions are listed separately below and are not added into an estimated budget.</p></div> :
      <div className="offer-grid">{sorted.slice(0, limit).map(t => <article className="offer-card trip-card" key={`${t.searchId}:${t.id}`}>
        <div className="card-top"><span className="tag">Sum of quoted totals</span><span>Flight + stay</span></div>
        <p className="eyebrow">{t.searchName}</p><h3>{t.destination}</h3>
        <strong className="price trip-price">{money({ totalMinor: price(t), currency: t.currency })}</strong>
        <p className="price-basis">{basis === 'total' ? `For ${t.travelers} travelers` : 'Per person average, including children'}</p>
        <p>{t.nights} nights · {t.rooms} room(s)</p>
        <p>{t.departureDate ? `${t.departureDate} → ${t.returnDate}` : 'Exact travel dates unconfirmed'}</p>
        <p className="preference"><strong>Flight:</strong> {t.flight.title}<br /><strong>Stay:</strong> {t.stay.title}</p>
        <details className="trip-breakdown"><summary>Price breakdown & booking details</summary><dl>
          <div><dt>Quoted flight total for everyone</dt><dd>{money({ totalMinor: t.flightTotalMinor, currency: t.currency })}</dd></div>
          <div><dt>Quoted accommodation total</dt><dd>{money({ totalMinor: t.stayTotalMinor, currency: t.currency })}</dd></div></dl>
          <ul>{t.bookingNotes.map((text, i) => <li key={i}>{text}</li>)}</ul>
        </details>
        <small>Oldest component checked {new Date(t.checkedAt).toLocaleString()}</small>
        <div className="trip-links"><button type="button" className="primary" onClick={() => onSelect(t.flight)}>View flight</button>
          <button type="button" className="primary" onClick={() => onSelect(t.stay)}>View stay</button></div>
      </article>)}</div>}
    {sorted.length > limit && <button className="text-button" onClick={() => setLimit(limit + 12)}>Show more flight + stay options</button>}
  </section>;
}
