import type { Discovery } from '../../../packages/shared/src/index.js';

const formatter = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
export function formatTravelDate(day: string) { return formatter.format(new Date(`${day}T00:00:00Z`)); }

export function PromotionDates({ offer }: { offer: Discovery }) {
  return <div className="promotion-dates">
    <p><strong>{offer.type === 'stay' ? 'Check-in' : 'Departure'}:</strong> {offer.departureDates.length
      ? offer.departureDates.map(formatTravelDate).join(', ') : offer.dateWindow
        ? `${formatTravelDate(offer.dateWindow.earliestDeparture)} – ${formatTravelDate(offer.dateWindow.latestDeparture)}` : 'Not published by the provider'}</p>
    <p><strong>{offer.type === 'stay' ? 'Check-out' : 'Return'}:</strong> {offer.returnDates?.length
      ? offer.returnDates.map(formatTravelDate).join(', ') : offer.dateWindow
        ? `${formatTravelDate(offer.dateWindow.earliestReturn)} – ${formatTravelDate(offer.dateWindow.latestReturn)}`
        : offer.journey === 'one-way' ? 'Not included · one-way flight' : 'Not published by the provider'}</p>
    {!!offer.nights && <p>{offer.nights} nights</p>}
  </div>;
}
