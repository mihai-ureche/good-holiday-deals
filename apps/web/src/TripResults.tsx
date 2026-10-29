import React, { useState } from 'react';
import { money } from '../../../packages/shared/src/index.js';
import type { CombinedTrip } from '../../../packages/shared/src/combinations.js';

export type ListedTrip = CombinedTrip & { searchId: string; searchName: string };
export function TripResults({ trips, sort }: { trips: ListedTrip[]; sort: string }) {
  const [basis, setBasis] = useState('total');
  const [limit, setLimit] = useState(12);
  const values = (t: ListedTrip) => basis === 'total' ? [t.totalMinorMin, t.totalMinorMax] : [t.perPersonMinorMin, t.perPersonMinorMax];
  const sorted = [...trips].sort((a, b) => (sort === 'asc' ? 1 : -1) * (values(a)[0]! - values(b)[0]!));
  const range = (t: ListedTrip, min: number, max: number) => {
    const low = money({ totalMinor: min, currency: t.currency });
    return min === max ? low : `${low} – ${money({ totalMinor: max, currency: t.currency })}`;
  };
  return <section className="trip-results" aria-label="Flight and accommodation combinations">
    <div className="advertised-heading"><div><h3 className="results-heading">Flight + accommodation <span className="count">{trips.length}</span></h3>
      <p className="filter-note">Two separate bookings in the same destination. Budget estimates use public starting prices; check the dates, return journey, room capacity and final costs.</p></div>
      <label>Show prices<select value={basis} onChange={e => setBasis(e.target.value)}><option value="total">Total for all travelers</option><option value="person">Average per person</option></select></label></div>
    {!trips.length ? <div className="empty compact"><h3>No flight + stay combinations yet.</h3><p>Include both Flights and Stays in your search, then choose Search now. Components need the same destination and currency and a usable accommodation price basis.</p></div> :
      <div className="offer-grid">{sorted.slice(0, limit).map(t => <article className="offer-card trip-card" key={`${t.searchId}:${t.id}`}>
        <div className="card-top"><span className="tag">{t.confidence === 'budget-estimate' ? 'Illustrative budget' : 'Sum of quoted totals'}</span><span>Flight + stay</span></div>
        <p className="eyebrow">{t.searchName}</p><h3>{t.destination}</h3>
        <strong className="price trip-price">{range(t, values(t)[0]!, values(t)[1]!)}</strong>
        <p className="price-basis">{basis === 'total' ? `For ${t.travelers} travelers` : 'Per person average, including children'}</p>
        <p>{t.minNights === t.maxNights ? t.minNights : `${t.minNights}–${t.maxNights}`} nights · {t.rooms} room(s)</p>
        <p>{t.departureDate ? `${t.departureDate} → ${t.returnDate}` : 'Exact travel dates unconfirmed'}</p>
        <p className="preference"><strong>Flight:</strong> {t.flight.title}<br /><strong>Stay:</strong> {t.stay.title}</p>
        {t.confidence === 'budget-estimate' && <p className="budget-caveat">Budget only. Equal airfares for children and adults are assumed. Return fare and nightly room basis may also be assumptions.</p>}
        <details className="trip-breakdown"><summary>Price breakdown & assumptions</summary><dl>
          <div><dt>Flight budget for everyone</dt><dd>{money({ totalMinor: t.flightTotalMinor, currency: t.currency })}</dd></div>
          <div><dt>Accommodation budget</dt><dd>{range(t, t.stayTotalMinorMin, t.stayTotalMinorMax)}</dd></div></dl>
          <ul>{t.assumptions.map((text, i) => <li key={i}>{text}</li>)}</ul>
        </details>
        <small>Oldest component checked {new Date(t.checkedAt).toLocaleString()}</small>
        <div className="trip-links"><a className="primary" href={t.flight.url} target="_blank" rel="noopener noreferrer">Check flight ↗</a>
          <a className="primary" href={t.stay.url} target="_blank" rel="noopener noreferrer">Check stay ↗</a></div>
      </article>)}</div>}
    {sorted.length > limit && <button className="text-button" onClick={() => setLimit(limit + 12)}>Show more flight + stay options</button>}
  </section>;
}
