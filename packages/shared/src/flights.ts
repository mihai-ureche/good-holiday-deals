import { isSpecificOffer, type Offer } from './index.js';

export function roundTripPrice(offer: Offer) {
  if (offer.type !== 'flight' || !isSpecificOffer(offer)) return null;
  const checked = Date.parse(offer.checkedAt);
  if (!Number.isFinite(checked) || checked < Date.now() - 48 * 3600000 || checked > Date.now() + 300000) return null;
  const travelers = offer.adults + offer.childrenAges.length;
  if (travelers < 1 || !Number.isSafeInteger(offer.totalMinor) || offer.totalMinor <= 0) return null;
  return { travelers, totalMinor: offer.totalMinor, perPersonMinor: Math.round(offer.totalMinor / travelers) };
}
