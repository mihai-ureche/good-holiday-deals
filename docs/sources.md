# Travel source coverage

Assessed on 29 October 2026 using ordinary public HTTP requests. No paid APIs, browser automation, user login, CAPTCHA bypass, or booking submission is used. The source catalog is visible in the app.

| Site | Current integration | Coverage and limits |
| --- | --- | --- |
| [Vola.ro](https://www.vola.ro/) | Public advertised flights | Homepage promotion cards expose a one-adult price and known origin. Only recognized origins are accepted; current cards depart from Bucharest. Dates, baggage, child fares and family availability are not established. |
| [Booking.com](https://www.booking.com/) | Manual provider link | No automated quote integration. Live accommodation results require a supported integration and suitable access. |
| [Travelminit.ro](https://travelminit.ro/) | Public advertised stays | Homepage carousel cards expose a displayed promotional price, occupancy description, and sometimes dates/nights. Known dates/nights are filtered against the search. Promotions for one night will not appear in a five-night search. Rates may carry promotional/membership conditions. |
| [eSky.ro](https://www.esky.ro/) | Manual provider link | Its [crawling rules](https://www.esky.ro/robots.txt) exclude flight/stay search and API paths. Those paths are not crawled. |
| [ChristianTour.ro](https://christiantour.ro/) | Public advertised holidays | The homepage currently redirects to a public campaign with destination cards and per-person starting prices. The parser supports that observed layout. Dates, departure airports, duration, occupancy, transport and other inclusions need confirmation. No search/API paths excluded by its [crawling rules](https://christiantour.ro/robots.txt) are fetched. |
| [DirectBooking.ro](https://www.directbooking.ro/) | Public advertised hotels | Public hotel cards expose destination and starting prices; the basis/occupancy/dates are not specified. The [published crawl delay](https://www.directbooking.ro/robots.txt) is respected. Hotel links may point to destination-specific DirectBooking subdomains, but those links are not fetched by this adapter. |
| [AmFostAcolo.ro](https://amfostacolo.ro/) | Manual review link | Included as a traveller-review reference, not a live quote provider. Reviews are not collected or represented as priced offers. |
| [Skyscanner.ro](https://www.skyscanner.ro/zboruri-de-la/buch/zboruri-ieftine-de-la-bucuresti.html) | Public Bucharest route promotions | Public landing-page cards expose fares, currency and dated return links. Dates and duration are retained and filtered. Its [crawling rules](https://www.skyscanner.ro/robots.txt) exclude transport results; those links are shown to users but never fetched by the crawler. |
| [Momondo.ro](https://www.momondo.ro/zboruri-din-bucuresti) | Public Bucharest route promotions | Route cards expose destination and per-person starting prices. The inspected layout did not state the complete date/journey context, which remains unconfirmed. |
| [Kiwi.com](https://www.kiwi.com/en/city/flights-from-bucharest-romania/) | Public Bucharest city deals | Cards expose fare currency and sometimes departure/return date windows. Those windows are retained and filtered against requested nights. Exact dates, baggage, family prices and self-transfer conditions need checking. |
| [KAYAK](https://www.ro.kayak.com/) | Public flights and hotels | The Romanian homepage groups flight and hotel promotions by destination. Flight origins are preserved. Dates and hotel room-night basis are not stated on these cards; combined budgets expose the rate-basis/return-fare assumptions. `kayak.ro` was not reachable during assessment; the working Romanian site is `www.ro.kayak.com`. |
| [Cheapflights](https://www.cheapflights.com/flights-from-bucharest/) | Public Bucharest route fares | Reads destination fare cards and retains source currency (USD in the inspected page). Airline-only price adverts are excluded. Return fares and dates are unconfirmed. |
| [Eximtur.ro](https://www.eximtur.ro/) | Manual provider link | The inspected homepage exposed destination links, without usable priced quote cards. Source-specific integration remains pending. |
| [Paravion.ro](https://www.paravion.ro/) | Manual provider link | The inspected homepage returned a redirect page. No reliable priced-quote adapter is enabled. |

## Meaning of a result

An **advertised offer** is a starting price seen on a public provider page. Known date/origin constraints are filtered; unknown facts remain explicitly unconfirmed. Free-text weather preferences and swimming suitability are not yet evaluated. Generic public leads may therefore need substantial checking on the provider's website.

**Flight + accommodation** pairs components for the same city and currency. The five new flight sources are included in the catalog; Bucharest-specific adapters skip other origins. Actual compatible family quotes can be summed when dates and party match. Public flight fares plus usable nightly hotel rates produce clearly marked **illustrative budgets**, with a nights range, selected rooms, a full-group total and a per-person average. Children are assumed to pay the adult airfare; unknown return fares are estimated as a second leg at the same rate. Unspecified hotel bases are excluded, and assumed nightly hotel bases are explicitly disclosed. The app does not confirm availability or book either component. Flights and accommodation remain separate bookings.

Each card shows its original price basis and check time. Prices are filtered to the search currency without guessed conversion. The app groups public leads by price basis before sorting. The confirmed family-total section remains separate.

## Reliability and budget

The collector reads up to nine public landing pages, sequentially. It respects robots.txt, caches responses, bounds download size/time, and checks redirects against a fixed source allowlist. Manual and scheduled searches share a database collection lock. A changed card layout, inaccessible robots.txt, blocked response, or network failure produces an unavailable-source status instead of fabricated data. A successful source can still contribute results when another fails.

Public HTML can change without notice. Fixture tests exercise the observed layouts; optional live smoke checks verify current compatibility without making normal tests depend on live sites. No API contract or ongoing access guarantee is implied. Confirmed date-and-family quotes need further source integrations or provider access, within the agreed hosting/data budget.
