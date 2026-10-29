import { z } from 'zod';
import { config } from '../../api/src/config.js';
import { money, isSpecificOffer, type Offer, type Discovery } from '../../../packages/shared/src/index.js';
import type { CombinedTrip } from '../../../packages/shared/src/combinations.js';

export function digestText(sections: { name: string; offers: Offer[]; discoveries?: Discovery[]; combinations?: CombinedTrip[]; status: string }[], appUrl: string) {
  return ['Your morning travel shortlist', '', ...sections.flatMap(s => [s.name, s.status,
    ...(s.combinations?.length ? ['Flight + accommodation, booked separately:', ...s.combinations.slice(0, 8).map(t =>
      `${t.destination} — SUM OF QUOTED TOTALS\n`
      + `Total ${money({ totalMinor: t.totalMinor, currency: t.currency })}; `
      + `average per traveler ${money({ totalMinor: t.perPersonMinor, currency: t.currency })}\n`
      + `${t.nights} nights, ${t.travelers} travelers, ${t.rooms} room(s)\nFlight: ${t.flight.title} — ${t.flight.url}\nStay: ${t.stay.title} — ${t.stay.url}\n`
      + `${t.bookingNotes.join('\n')}\nChecked: ${t.checkedAt}\n`)] : []),
    ...s.offers.filter(isSpecificOffer).slice(0, 15).map(o => `${o.title} — ${money(o)} (${o.priceBasis === 'family-total' ? 'family total' : 'indicative price'})\n`
      + `Quote ${o.booking!.reference}: ${o.booking!.description}\n`
      + `${o.destination} · ${o.departureDate} to ${o.returnDate} · ${o.type}\n${o.url}\n`
      + `Included: ${o.inclusions.join(', ') || 'Check with provider'}\nSwimming: ${o.swimmingEvidence || 'Not verified'}\nChecked: ${o.checkedAt}\n`),
    ...(s.discoveries?.length ? ['Promotions — not confirmed family quotes:', ...s.discoveries.slice(0, 10).map(d =>
      `${d.title} — from ${money({ totalMinor: d.fromMinor, currency: d.currency })} (${d.priceUnit === 'person' ? 'per person' : d.priceUnit === 'room-night' ? 'per room/night; verify basis' : d.priceUnit === 'advertised-stay' ? 'advertised stay' : 'price basis unspecified'})\n`
      + `${d.conditions}\nLink opens ${d.linkKind === 'search' ? 'an advertised search' : d.linkKind === 'property' ? 'a hotel page' : 'a promotion/destination page'}; no individual quote.\n${d.url}\nChecked: ${d.checkedAt}\n`)] : []), '']),
  `Prices and availability may change. Confirm all details directly with the provider.`,
  `View deals or pause daily emails: ${appUrl}`].join('\n');
}

let cached: { value: string; expires: number } | undefined;
export async function graphToken(fetcher: typeof fetch = fetch) {
  if (cached && cached.expires > Date.now()) return cached.value;
  const response = await fetcher(`https://login.microsoftonline.com/${encodeURIComponent(config.GRAPH_TENANT_ID)}/oauth2/v2.0/token`, {
    method: 'POST', signal: AbortSignal.timeout(20_000),
    body: new URLSearchParams({ client_id: config.GRAPH_CLIENT_ID, client_secret: config.GRAPH_CLIENT_SECRET,
      scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }),
  });
  if (!response.ok) throw new Error(`Graph authentication failed (${response.status})`);
  const data = z.object({ access_token: z.string().min(1), expires_in: z.number().positive() }).parse(await response.json());
  cached = { value: data.access_token, expires: Date.now() + Math.max(0, data.expires_in - 120) * 1000 };
  return cached.value;
}

export async function sendDigest(accessToken: string, email: string, content: string, fetcher: typeof fetch = fetch) {
  const response = await fetcher(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(config.GRAPH_SENDER)}/sendMail`, {
    method: 'POST', signal: AbortSignal.timeout(20_000),
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: { subject: 'Your morning travel deals',
      body: { contentType: 'Text', content }, toRecipients: [{ emailAddress: { address: email } }] }, saveToSentItems: true }),
  });
  if (response.status !== 202) throw new Error(`Graph send request failed (${response.status}); verify Sent Items before retrying`);
}
