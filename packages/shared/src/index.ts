import { z } from 'zod';

const day = z.iso.date();
export const searchSchema = z.object({
  name: z.string().trim().min(1).max(100),
  departure: z.string().trim().min(2).max(120),
  nearbyAirports: z.boolean().default(true),
  earliestDeparture: day,
  latestReturn: day,
  minNights: z.number().int().min(1).max(60),
  maxNights: z.number().int().min(1).max(60),
  adults: z.number().int().min(1).max(8),
  childrenAges: z.array(z.number().int().min(0).max(17)).max(6),
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

export function matchingOffers(criteria: SearchCriteria, offers: Offer[]): Offer[] {
  const ages = (v: number[]) => [...v].sort((a, b) => a - b).join(',');
  return offers.filter(o => {
    const nights = (Date.parse(o.returnDate) - Date.parse(o.departureDate)) / 86400000;
    return o.currency === criteria.currency && criteria.tripTypes.includes(o.type)
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
