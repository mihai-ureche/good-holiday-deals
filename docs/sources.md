# Travel provider coverage

Reviewed on 31 October 2026. The production registry and source panel expose Ignav and Duffel only. Both are flight-only.

| Provider | Current integration | Coverage and limits |
| --- | --- | --- |
| [Ignav](https://ignav.com/docs) | Optional live flight API | Activates with `IGNAV_API_KEY`. Flexible-date prices shortlist candidates; exact searches and exact-itinerary booking links are required before a result is shown. Ignav does not provide accommodation inventory. |
| [Duffel](https://duffel.com/docs) | Optional live flight API | Activates with `DUFFEL_ACCESS_TOKEN`. The token must have Flights and Links permissions. The adapter never calls Duffel Stays. |

## Meaning of a result

Specific offers require a provider-supplied quote reference, one quoted party total, exact dates, and a secure provider handoff. Round-trip flights additionally require `Offer.journey: 'round-trip'` and `booking.live: true`. The total is never calculated from an advertised single-adult price.

Flight + accommodation results require separate, specific flight and room quotes matching destination, currency, party, dates, and room count. The app combines their quoted totals but does not invent a package price. Flights and stays remain separate bookings.

No live accommodation adapter is currently registered, so stay and combined results remain empty.

## Ignav flight search

Country selection starts with population-ranked cities from [countries.dev](https://countries.dev/cities-api) (GeoNames data, CC BY 4.0). Ignav resolves them to up to 20 unique airports, and the user selects at most five. For each selected airport and allowed stay length, the app scans the flexible date window, exact-checks the strongest candidates, and retains up to three verified variants per airport.

Only a verified whole-party price and a complete HTTPS purchase plan can become an Ignav result: either one link covering both legs or two separately verified links whose prices add to the displayed total. Quotes expire from this app after 30 minutes and must be reconfirmed on the booking page.

## Duffel flight search

Duffel Flights creates a return offer request with two slices and the saved passenger ages. Returned offers must match the requested currency, contain both slices, and have a future `expires_at` value.

Duffel Links provides a hosted flight search-and-book handoff. It performs a fresh availability search rather than opening the API quote directly, so users must reconfirm the itinerary and final total. Links requires a public HTTPS callback URL; set `DUFFEL_LINKS_APP_URL` when `APP_URL` is not suitable. Stay-only saved searches return immediately without calling Duffel.
