# Travel source coverage

Assessed on 29 October 2026 using ordinary public HTTP requests. No paid APIs, browser automation, user login, CAPTCHA bypass, or booking submission is used. The source catalog is visible in the app.

| Site | Current integration | Coverage and limits |
| --- | --- | --- |
| [Vola.ro](https://www.vola.ro/) | Live flight quotes not connected | Homepage starting fares do not establish dates, a round trip or the full party price and are excluded from results. |
| [Booking.com](https://www.booking.com/) | Manual provider link | No automated quote integration. Live accommodation results require a supported integration and suitable access. |
| [Travelminit.ro](https://travelminit.ro/) | Public advertised stays | Homepage carousel cards expose a displayed promotional price, occupancy description, and sometimes dates/nights. Known dates/nights are filtered against the search. Promotions for one night will not appear in a five-night search. Rates may carry promotional/membership conditions. |
| [eSky.ro](https://www.esky.ro/) | Manual provider link | Its [crawling rules](https://www.esky.ro/robots.txt) exclude flight/stay search and API paths. Those paths are not crawled. |
| [ChristianTour.ro](https://christiantour.ro/) | Public advertised holidays | The homepage currently redirects to a public campaign with destination cards and per-person starting prices. The parser supports that observed layout. Dates, departure airports, duration, occupancy, transport and other inclusions need confirmation. No search/API paths excluded by its [crawling rules](https://christiantour.ro/robots.txt) are fetched. |
| [DirectBooking.ro](https://www.directbooking.ro/) | Public advertised hotels | Public hotel cards expose destination and starting prices; the basis/occupancy/dates are not specified. The [published crawl delay](https://www.directbooking.ro/robots.txt) is respected. Hotel links may point to destination-specific DirectBooking subdomains, but those links are not fetched by this adapter. |
| [AmFostAcolo.ro](https://amfostacolo.ro/) | Manual review link | Included as a traveller-review reference, not a live quote provider. Reviews are not collected or represented as priced offers. |
| [Ignav](https://ignav.com/) | Optional live flight API | Activates with `IGNAV_API_KEY`. Flexible-date prices shortlist candidates; exact searches and exact-itinerary booking links are required before a result is shown. |
| [Skyscanner.ro](https://www.skyscanner.ro/) | Not connected | Public landing-page fares are excluded because they are not whole-party live quotes. |
| [Momondo.ro](https://www.momondo.ro/) | Live flight quotes not connected | Public route starting prices are excluded; no full-party round-trip quote integration is connected. |
| [Kiwi.com](https://www.kiwi.com/) | Live flight quotes not connected | Public city-deal fares and flexible windows are excluded; no full-party round-trip quote integration is connected. |
| [KAYAK](https://www.ro.kayak.com/) | Public hotel promotions | Flight teasers and dated public route fares are excluded. They do not establish an individual live quote for the selected party. The hotel parser retains the published price basis and destination; unknown dates/occupancy remain unconfirmed. |
| [Cheapflights](https://www.cheapflights.com/) | Live flight quotes not connected | Public route starting fares are excluded; no full-party round-trip quote integration is connected. |
| [Eximtur.ro](https://www.eximtur.ro/) | Manual provider link | The inspected homepage exposed destination links, without usable priced quote cards. Source-specific integration remains pending. |

## Meaning of a result

An **advertised offer** is a starting price seen on a public provider page. Known date/origin constraints are filtered; unknown facts remain explicitly unconfirmed. Free-text weather preferences and swimming suitability are not yet evaluated. Generic public leads may therefore need substantial checking on the provider's website.

**Specific offers** require a provider-supplied quote reference, precise description, one quoted family total, exact dates and an individual-offer link. Stay quotes must also identify the room count. Expired quotes and older saved records lacking that evidence are excluded. The current public adapters supply promotions only; they do not supply these quotes.

**Round-trip flights** require `Offer.journey: 'round-trip'` and `booking.live: true`, alongside the quoted total, exact party and individual-offer link. Rows show outbound and return dates together, the quoted total, and its per-traveler average. The total is never calculated from an advertised single-adult price. Public flight promotions are excluded at collection, API, UI and digest boundaries, including records saved before this change. Flight-only searches skip promotion scraping. Until a live adapter is connected, the page says that flight pricing is not connected; it does not claim that no real flights exist.

**Flight + accommodation** pairs only specific flight and room quotes for matching city, currency, party, dates and room count. It shows one total or per-person average. Public promotions never produce estimated return fares, multiplied child prices, nightly budgets or price ranges. The two components are separate bookings. Clicking **View flight** or **View stay** opens that component's quote details and specific provider link.

**Promotions · starting prices** remains a separate section. Clicking a promotion shows exactly the source facts collected, with unknowns identified. Links are labeled as searches, hotel pages or destination/promotion pages; they are not represented as individual quotes. Travelminit links retain the source's date and occupancy parameters. Published price ranges are rejected instead of being truncated to their minimum. Each card retains its original price basis, currency and check time. No currency conversion is guessed.

Stay and holiday cards show published dates and direct provider links. The public KAYAK dated-route lookup is removed: its fares are not live party quotes and its links only rerun date searches.

## Connecting live flights

No flight API credentials are configured by default. The Ignav adapter activates only when `IGNAV_API_KEY` is set. Country selection starts with population-ranked cities from [countries.dev](https://countries.dev/cities-api) (GeoNames data, CC BY 4.0), but those names are only discovery input: Ignav resolves them to up to 20 unique airports, the first five are selected initially, and the user may replace them while keeping at most five. The saved flight search uses the resulting IATA codes. For each selected airport and allowed stay length, Cheapest Dates covers every departure date in the window. The app exact-checks the strongest candidates per airport and retains up to three verified variants for each selected airport. Only a verified whole-party price and a complete HTTPS purchase plan can become a result: either one non-search link covering both legs, or one separately verified link for each leg whose prices add to the displayed total.

Provider access was checked on 31 October 2026. [Ignav](https://ignav.com/pricing) offers a self-service key with 1,000 successful requests included, then usage pricing without a monthly minimum. [Amadeus Self-Service's documented limitations](https://admin.developers.amadeus.com/self-service/apis-docs/guides/developer-guides/faq/) exclude low-cost carriers, which matters for European family routes. Aviasales real-time search requires a large established audience, while its freely accessible data API is cached and cannot prove a current family total. No supplier account or paid subscription was activated by this repository change.

## Reliability and budget

The collector reads up to four public stay/holiday landing pages, sequentially, and skips them for flight-only searches. It respects robots.txt, caches responses, bounds download size/time, and checks redirects against a fixed source allowlist. Manual and scheduled searches share a database collection lock. A changed card layout, inaccessible robots.txt, blocked response, or network failure produces an unavailable-source status instead of fabricated data. A successful source can still contribute results when another fails.

Public HTML can change without notice. Fixture tests exercise the observed layouts; optional live smoke checks verify current compatibility without making normal tests depend on live sites. No API contract or ongoing access guarantee is implied. Confirmed date-and-family quotes need further source integrations or provider access, within the agreed hosting/data budget.
