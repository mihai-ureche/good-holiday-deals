import { useId } from 'react';
import { isSpecificOffer, money, type Offer, type Discovery } from '../../../packages/shared/src/index.js';
import { FullWindowDialog } from './FullWindowDialog.js';
import './offers.css';

export function OfferDetails({ offer, onDismiss }: { offer: Offer | Discovery; onDismiss: () => void }) {
  const titleId = useId();
  const promotion = 'fromMinor' in offer;
  const specific = !promotion && isSpecificOffer(offer);
  const linkLabel = promotion ? offer.linkKind === 'search' ? 'Open advertised search'
    : offer.linkKind === 'property' ? 'Open hotel page' : 'Open promotion page' : 'Open this quoted offer';
  return <FullWindowDialog titleId={titleId} className="offer-details-modal" onDismiss={onDismiss}>
    <div className="message-content offer-details-content">
      <p className="eyebrow">{promotion ? 'PROMOTION · ADVERTISED STARTING PRICE' : 'SPECIFIC QUOTED OFFER'} · {offer.provider}</p>
      <h2 id={titleId}>{offer.title}</h2>
      <p className="offer-detail-price">{promotion ? 'From ' : ''}{money({ totalMinor: promotion ? offer.fromMinor : offer.totalMinor, currency: offer.currency })}</p>
      <dl className="offer-facts">
        <div><dt>Destination</dt><dd>{offer.destination}</dd></div>
        <div><dt>Type</dt><dd>{offer.type}</dd></div>
        {promotion ? <>
          <div><dt>Advertised price basis</dt><dd>{offer.priceUnit === 'person' ? 'Per person' : offer.priceUnit === 'advertised-stay' ? 'Advertised stay'
            : offer.priceUnit === 'room-night' ? offer.basisAssumed ? 'Room/night assumed; not stated by provider' : 'Per room/night' : 'Not stated by provider'}</dd></div>
          {offer.type !== 'stay' && <div><dt>Departure</dt><dd>{offer.departureCities.join(', ') || 'Not stated by provider'}</dd></div>}
          <div><dt>{offer.type === 'stay' ? 'Advertised check-in' : 'Advertised departure'}</dt><dd>{offer.departureDates.length ? offer.departureDates.join(', ')
            : offer.dateWindow ? `Departure ${offer.dateWindow.earliestDeparture} to ${offer.dateWindow.latestDeparture}; return ${offer.dateWindow.earliestReturn} to ${offer.dateWindow.latestReturn}`
              : 'Exact dates not stated by provider'}</dd></div>
          {!!offer.returnDates?.length && <div><dt>{offer.type === 'stay' ? 'Advertised check-out' : 'Advertised return'}</dt><dd>{offer.returnDates.join(', ')}</dd></div>}
          {offer.type === 'flight' && <div><dt>Journey</dt><dd>{offer.journey === 'round-trip' ? 'Return flight' : offer.journey === 'one-way' ? 'One-way flight' : 'Not stated by provider'}</dd></div>}
          <div><dt>Advertised duration</dt><dd>{offer.nights ? `${offer.nights} nights` : 'Not stated by provider'}</dd></div>
          <div><dt>Travelers / rooms</dt><dd>Your requested party and room availability are not confirmed.</dd></div>
        </> : <>
          <div><dt>Travel dates</dt><dd>{offer.departureDate} → {offer.returnDate}</dd></div>
          <div><dt>Travelers</dt><dd>{offer.adults} adults{offer.childrenAges.length ? ` · children aged ${offer.childrenAges.join(', ')}` : ''}</dd></div>
          {offer.booking?.rooms && <div><dt>Rooms</dt><dd>{offer.booking.rooms}</dd></div>}
          <div><dt>Quote reference</dt><dd>{offer.booking?.reference ?? offer.externalId}</dd></div>
          <div><dt>Included</dt><dd>{offer.inclusions.join(', ') || 'Not stated by provider'}</dd></div>
          {offer.booking?.expiresAt && <div><dt>Quote expires</dt><dd>{new Date(offer.booking.expiresAt).toLocaleString()}</dd></div>}
        </>}
        <div><dt>Checked</dt><dd>{new Date(offer.checkedAt).toLocaleString()}</dd></div>
      </dl>
      <p className="offer-detail-note">{promotion ? offer.conditions : offer.booking?.description}</p>
      {promotion && <p className="offer-detail-note">This is a promotion, with no individual flight or room quote. The link opens {offer.linkKind === 'search'
        ? 'the advertised search, which may show several results' : offer.linkKind === 'property' ? 'the hotel page, where a room and rate still need to be selected' : 'the provider’s promotion or destination page'}.
        The advertised price may differ for your dates and travelers.</p>}
      {(promotion || specific) && <a className="primary" href={offer.url} target="_blank" rel="noopener noreferrer">{linkLabel} ↗</a>}
      {!promotion && !specific && <p className="offer-detail-note">This quote is expired or has no specific offer link. Run your search again.</p>}
      <p className="offer-link-address">{offer.url}</p>
      {promotion && offer.sourceUrl && <p className="filter-note">Found on <a href={offer.sourceUrl} target="_blank" rel="noopener noreferrer">{new URL(offer.sourceUrl).hostname}</a>.</p>}
    </div>
  </FullWindowDialog>;
}
