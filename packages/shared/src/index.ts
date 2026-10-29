import { z } from 'zod';
import { countryCode, matchesDestination } from './destinations.js';

const day = z.iso.date();
export const searchSchema = z.object({
  name: z.string().trim().min(1).max(100),
  departure: z.string().trim().min(2).max(120),
  targetCity: z.string().trim().max(120).default(''),
  targetCountry: z.string().trim().max(120).refine(v => !v || !!countryCode(v), 'Choose a valid destination country').default(''),
  nearbyAirports: z.boolean().default(true),
  earliestDeparture: day,
  latestReturn: day,
  minNights: z.number().int().min(1).max(60),
  maxNights: z.number().int().min(1).max(60),
  adults: z.number().int().min(1).max(8),
  childrenAges: z.array(z.number().int().min(0).max(17)).max(6),
  rooms: z.number().int().min(1).max(6).optional(),
  currency: z.enum(['EUR', 'RON', 'USD', 'GBP']).default('EUR'),
  tripTypes: z.array(z.enum(['package', 'flight', 'stay'])).min(1).max(3),
  swimming: z.enum(['any', 'sea', 'heated-pool', 'either']).default('any'),
  preferences: z.string().trim().max(1000).default(''),
  active: z.boolean().default(true),
}).refine(s => s.maxNights >= s.minNights, { message: 'Maximum nights must be at least minimum nights' })
  .refine(s => s.latestReturn > s.earliestDeparture, { message: 'Return window must end after departure' })
  .refine(s => (Date.parse(s.latestReturn) - Date.parse(s.earliestDeparture)) / 86400000 >= s.minNights,
    { message: 'The travel window must fit the minimum stay' });

export type SearchCriteria = z.infer<typeof searchSchema>;
export type SavedSearch = SearchCriteria & { id: string; createdAt: string };

export const offerSchema = z.object({
  provider: z.string().min(1).max(100),
  externalId: z.string().min(1).max(200),
  title: z.string().min(1).max(300),
  destination: z.string().min(1).max(200),
  destinationCountry: z.string().trim().min(2).max(120).optional(),
  type: z.enum(['package', 'flight', 'stay']),
  departureDate: day,
  returnDate: day,
  totalMinor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  currency: z.enum(['EUR', 'RON', 'USD', 'GBP']),
  priceBasis: z.enum(['family-total', 'indicative']),
  adults: z.number().int().min(1),
  childrenAges: z.array(z.number().int().min(0).max(17)),
  url: z.url().refine(v => new URL(v).protocol === 'https:', 'Provider links must use HTTPS'),
  inclusions: z.array(z.string().max(200)).max(20),
  swimming: z.enum(['sea', 'heated-pool', 'unknown']),
  swimmingEvidence: z.string().max(500),
  checkedAt: z.iso.datetime(),
});
export type Offer = z.infer<typeof offerSchema>;

// Public adverts are leads, never inferred family quotes. Unknown facts stay unknown.
export const discoverySchema = z.object({
  provider: z.string().min(1).max(100),
  externalId: z.string().min(1).max(200),
  title: z.string().min(1).max(300),
  destination: z.string().min(1).max(200),
  destinationCountry: z.string().trim().min(2).max(120).optional(),
  type: z.enum(['package', 'flight', 'stay']),
  fromMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  currency: z.enum(['EUR', 'RON', 'USD', 'GBP']),
  priceUnit: z.enum(['person', 'advertised-stay', 'room-night', 'unspecified']),
  journey: z.enum(['one-way', 'round-trip', 'unknown']).optional(),
  basisAssumed: z.boolean().optional(),
  url: z.url().refine(v => new URL(v).protocol === 'https:', 'Provider links must use HTTPS'),
  departureCities: z.array(z.string().max(100)).max(20),
  departureDates: z.array(day).max(100),
  dateWindow: z.object({ earliestDeparture: day, latestDeparture: day, earliestReturn: day, latestReturn: day }).optional(),
  nights: z.number().int().min(1).max(60).nullable(),
  conditions: z.string().min(1).max(600),
  checkedAt: z.iso.datetime(),
});
export type Discovery = z.infer<typeof discoverySchema>;

export function normalizedCity(value: string) {
  const v = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  if (/\b(bucharest|bucuresti|otp|buh|otopeni)\b/.test(v)) return 'bucuresti';
  if (/\b(cluj|clj)\b/.test(v)) return 'cluj';
  if (/\b(iasi|ias)\b/.test(v)) return 'iasi';
  if (/\b(timisoara|tsr)\b/.test(v)) return 'timisoara';
  return v;
}

export function matchingDiscoveries(criteria: SearchCriteria, discoveries: Discovery[]) {
  return discoveries.filter(d => {
    if (d.currency !== criteria.currency || !criteria.tripTypes.includes(d.type)) return false;
    if (!matchesDestination(criteria, d)) return false;
    if (d.type !== 'stay' && d.departureCities.length
      && !d.departureCities.some(city => normalizedCity(city) === normalizedCity(criteria.departure))) return false;
    if (d.nights !== null && (d.nights < criteria.minNights || d.nights > criteria.maxNights)) return false;
    if (d.dateWindow) {
      const w = d.dateWindow;
      const outLow = Math.max(Date.parse(w.earliestDeparture), Date.parse(criteria.earliestDeparture));
      const outHigh = Math.min(Date.parse(w.latestDeparture), Date.parse(criteria.latestReturn));
      const backLow = Date.parse(w.earliestReturn);
      const backHigh = Math.min(Date.parse(w.latestReturn), Date.parse(criteria.latestReturn));
      if (outLow > outHigh || backLow > backHigh || backHigh - outLow < criteria.minNights * 86400000
        || backLow - outHigh > criteria.maxNights * 86400000) return false;
    }
    if (d.departureDates.length && !d.departureDates.some(date => date >= criteria.earliestDeparture
      && (d.nights === null ? date < criteria.latestReturn
        : new Date(Date.parse(date) + d.nights * 86400000).toISOString().slice(0, 10) <= criteria.latestReturn))) return false;
    return true;
  }).sort((a, b) => a.fromMinor - b.fromMinor);
}

export function matchingOffers(criteria: SearchCriteria, offers: Offer[]): Offer[] {
  const ages = (v: number[]) => [...v].sort((a, b) => a - b).join(',');
  return offers.filter(o => {
    const nights = (Date.parse(o.returnDate) - Date.parse(o.departureDate)) / 86400000;
    return o.currency === criteria.currency && criteria.tripTypes.includes(o.type)
      && matchesDestination(criteria, o)
      && o.departureDate >= criteria.earliestDeparture && o.returnDate <= criteria.latestReturn
      && nights >= criteria.minNights && nights <= criteria.maxNights
      && o.adults === criteria.adults && ages(o.childrenAges) === ages(criteria.childrenAges);
  }).sort((a, b) => a.totalMinor - b.totalMinor);
}

export function localSchedule(now: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(now);
  const value = (name: string) => parts.find(p => p.type === name)!.value;
  return { day: `${value('year')}-${value('month')}-${value('day')}`,
    due: Number(value('hour')) >= 8 && Number(value('hour')) < 12 };
}

export function money(offer: Pick<Offer, 'totalMinor' | 'currency'>) {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: offer.currency }).format(offer.totalMinor / 100);
}
