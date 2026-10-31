# Travel provider coverage

Reviewed on 31 October 2026. The production registry and source panel expose Ignav and Duffel for flights and SearchAPI.io for stays.

| Provider | Current integration | Coverage and limits |
| --- | --- | --- |
| [Ignav](https://ignav.com/docs) | Optional live flight API | Activates with `IGNAV_API_KEY`. Flexible-date prices shortlist candidates; exact searches and exact-itinerary booking links are required before a result is shown. Ignav does not provide accommodation inventory. |
| [Duffel](https://duffel.com/docs) | Optional live flight API | Activates with `DUFFEL_ACCESS_TOKEN`. The token must have Flights and Links permissions. The adapter never calls Duffel Stays. |
| [SearchAPI.io](https://www.searchapi.io/docs/google-hotels-api) | Optional live accommodation API | Activates with `SEARCHAPI_API_KEY`. Uses Google Hotels for property discovery and Google Hotels Property for exact OTA rates and booking links. Its Google Flights engine is intentionally not used. |

## Meaning of a result

Specific offers require a provider-supplied quote reference, one quoted party total, exact dates, and a secure provider handoff. Round-trip flights additionally require `Offer.journey: 'round-trip'` and `booking.live: true`. The total is never calculated from an advertised single-adult price.

Flight + accommodation results require separate, specific flight and room quotes matching destination, currency, party, dates, and room count. The app combines their quoted totals but does not invent a package price. Flights and stays remain separate bookings.

SearchAPI accommodation quotes can combine with an Ignav or Duffel flight when party, dates, currency and destination match. For airport-targeted searches, the selected IATA code is used to match a hotel search with its flight even when locality labels differ.

## Ignav flight search

Country selection starts with population-ranked cities from [countries.dev](https://countries.dev/cities-api) (GeoNames data, CC BY 4.0). Ignav resolves them to up to 20 unique airports, and the user selects at most five. For each selected airport and allowed stay length, the app scans the flexible date window, exact-checks the strongest candidates, and retains up to three verified variants per airport.

Only a verified whole-party price and a complete HTTPS purchase plan can become an Ignav result: either one link covering both legs or two separately verified links whose prices add to the displayed total. Quotes expire from this app after 30 minutes and must be reconfirmed on the booking page.

## Duffel flight search

Duffel Flights creates a return offer request with two slices and the saved passenger ages. Returned offers must match the requested currency, contain both slices, and have a future `expires_at` value.

Duffel Links provides a hosted flight search-and-book handoff. It performs a fresh availability search rather than opening the API quote directly, so users must reconfirm the itinerary and final total. Links requires a public HTTPS callback URL; set `DUFFEL_LINKS_APP_URL` when `APP_URL` is not suitable. Stay-only saved searches return immediately without calling Duffel.

## SearchAPI accommodation search

SearchAPI Google Hotels accepts a destination query, dates, currency, adults and comma-separated child ages. The adapter searches only hotels, then requests property details for the cheapest eligible property so it can retain an OTA-specific total and HTTPS purchase link rather than a hotel homepage.

The integration supports one requested room, child ages 1–17, and no more than six total guests. Google Hotels has no room-count input and does not accept age zero, so the adapter declines those searches before making an API call. It validates the echoed dates, currency, adult count and child ages on both API responses. Property country, dates and currency must also match. Missing or malformed prices and booking links are discarded.

Flexible windows are sampled rather than exhaustively queried: at most five destination/date combinations per run, with one property detail lookup for each. This caps the default cost at ten SearchAPI credits per saved search run. The API key remains in the backend environment and is sent in an Authorization header, never in a request URL. SearchAPI is a metered intermediary for Google Travel data, and the final OTA page remains the authority for availability, room layout, taxes and cancellation terms.
