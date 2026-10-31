# Travel provider coverage

Reviewed on 31 October 2026. The production registry and source panel expose Ignav, Duffel, and Sabre only.

| Provider | Current integration | Coverage and limits |
| --- | --- | --- |
| [Ignav](https://ignav.com/docs) | Optional live flight API | Activates with `IGNAV_API_KEY`. Flexible-date prices shortlist candidates; exact searches and exact-itinerary booking links are required before a result is shown. Ignav does not provide accommodation inventory. |
| [Duffel](https://duffel.com/docs) | Optional live flight and accommodation APIs | Activates with `DUFFEL_ACCESS_TOKEN`. The account must have Stays and Duffel Links access to return accommodation and hosted booking handoffs. Flights and stays are searched independently for the same destination/date pairs. |
| [Sabre](https://developer.sabre.com/) | Optional live flight and accommodation APIs | Activates with the full OAuth user ID, password, four-character PCC, and a configured HTTPS booking-flow URL. Uses CERT by default. Developer Hub credentials are search-only; account entitlements determine which search APIs work. |

## Meaning of a result

Specific offers require a provider-supplied quote reference, one quoted party total, exact dates, and a secure provider handoff. Round-trip flights additionally require `Offer.journey: 'round-trip'` and `booking.live: true`. The total is never calculated from an advertised single-adult price.

Flight + accommodation results require separate, specific flight and room quotes matching destination, currency, party, dates, and room count. The app combines their quoted totals but does not invent a package price. Flights and stays remain separate bookings.

## Ignav flight search

Country selection starts with population-ranked cities from [countries.dev](https://countries.dev/cities-api) (GeoNames data, CC BY 4.0). Ignav resolves them to up to 20 unique airports, and the user selects at most five. For each selected airport and allowed stay length, the app scans the flexible date window, exact-checks the strongest candidates, and retains up to three verified variants per airport.

Only a verified whole-party price and a complete HTTPS purchase plan can become an Ignav result: either one link covering both legs or two separately verified links whose prices add to the displayed total. Quotes expire from this app after 30 minutes and must be reconfirmed on the booking page.

## Duffel flight and stay search

Duffel Flights creates a return offer request with two slices and the saved passenger ages. Returned offers must match the requested currency, contain both slices, and have a future `expires_at` value.

Duffel Stays searches by the selected destination airport's coordinates, requests the saved dates, guests, and room count, fetches complete rates for the strongest property result, and creates a final stay quote. Only that final quote becomes an accommodation offer.

When Flights and Stays are both selected, both Duffel product searches run for the same destination/date tasks. Matching quotes can therefore be combined directly. A run samples at most ten destination/date combinations by default because Duffel has no equivalent to Ignav's cheapest-dates endpoint and every stay quote needs several API calls.

Duffel Links provides a hosted search-and-book handoff. It performs a fresh availability search rather than opening the API quote directly, so users must reconfirm the itinerary or property, rooms, and final total. Links requires a public HTTPS callback URL; set `DUFFEL_LINKS_APP_URL` when `APP_URL` is not suitable.

## Sabre flight and stay search

Sabre authentication follows the v2 sessionless OAuth flow and caches the returned token until shortly before expiry. Airport selection uses Geo Autocomplete v2. Flights use Bargain Finder Max v5 and retain only two-leg round trips whose grouped itinerary dates and requested currency match the saved search. Passenger ages are sent as age-specific passenger type codes; lap and seated infants remain distinct. Quotes expire from this app after 30 minutes.

Accommodation uses Get Hotel Avail v5 with the selected airport as its reference point, the saved country, stay dates, currency, and room occupancies. The adapter accepts only returned rate keys and totals in the requested currency. For multiple rooms, Sabre requires identical adult/child counts in every requested room; when the saved party cannot be divided evenly across the rooms, the Sabre stay call is skipped rather than inventing an allocation or total.

The free Developer Hub credentials shown by Sabre are valid for the CERT environment and search only. They do not include the four-character PCC required in shopping payloads, and they cannot create reservations. Configure `SABRE_PCC` separately. Because Sabre does not provide hosted checkout, `SABRE_BOOKING_URL` must point at an operator-controlled flow that can reprice the selected flight or run Hotel Price Check with the returned lodging rate key. Do not point this setting at a generic home page.
