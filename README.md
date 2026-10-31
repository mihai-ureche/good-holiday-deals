# Good Holiday Deals

A private travel notebook for an invited group. Save flexible family searches, collect offers from source adapters, compare prices, and receive one morning digest at **08:00 Europe/Bucharest**, including summer time. Book directly with the provider.

## Current state

The foundation includes single-use email-bound invitations, password sign-in, private saved searches, family composition, flexible dates/nights, nearby-airport and swimming preferences, a sortable deals view, PostgreSQL storage, and a daily Microsoft Graph email worker. The UI distinguishes packages, flights, and stays and compares one currency at a time. Prices are stored as integer minor units.

**Ignav and Duffel provide flights; SearchAPI.io provides accommodation.** Duffel remains flight-only. SearchAPI's Google Flights engine is intentionally not registered, so it cannot become a third flight source. The previous public-page and manual provider catalog remains removed. See [source coverage and limitations](docs/sources.md).

### Flight + accommodation

Include **Flights** and **Stays** in the search and select the number of rooms. After **Search now**, open **Specific offers → Flight + accommodation**. A combination requires two identifiable provider quotes with offer-specific links, one price each, matching destination/currency/dates/travelers, and the requested room count. It displays one sum of quoted totals or one per-person average. Flights and stays are booked separately.

SearchAPI supplies exact-date, one-room accommodation quotes. A combined result can pair one of those rates with a matching Ignav or Duffel flight quote. Airport-targeted searches can match even when the hotel locality and flight destination use different city labels, provided both offers carry the same selected airport code.

**Round-trip flights** lists each qualifying flight as `Out 20.02.2027 – In 25.02.2027 · €100.00 each, average (€400.00 total · 4 travelers)`. This is an example of the format, not a live fare. The total must come from a live quote for the selected adults and children; the per-person average is calculated by dividing that quoted total. A single-adult advertised fare is never multiplied by the family size. Each row links to its individual quoted offer. Old, expired, one-way, undated and non-live flight quotes are excluded.

The [Ignav](https://ignav.com/) adapter activates when a key is supplied as `IGNAV_API_KEY`. For each of up to five destination airports it scans every departure date for every allowed stay length, exact-checks the strongest candidates, and retains only verified whole-party round trips with a complete purchase plan. That plan is either one exact link covering both legs or two separately priced exact links whose sum is displayed. Searches are bounded and run with low concurrency. Without the key, the UI reports that Ignav is not connected; an empty list is not presented as proof that no flights exist.

The [Duffel](https://duffel.com/docs) adapter activates with `DUFFEL_ACCESS_TOKEN` and is restricted to flights. It creates return Flight offer requests only when a saved search includes **Flights**; stay-only searches cause no Duffel API calls. The adapter checks at most ten destination/date combinations per run by default. Duffel Links supplies the hosted flight purchase handoff and performs a fresh availability check, so the itinerary and total must be reconfirmed there. The token needs Flights and Links permissions. `DUFFEL_LINKS_APP_URL` may provide its public HTTPS callback base and otherwise defaults to `APP_URL`.

The [SearchAPI.io Google Hotels](https://www.searchapi.io/docs/google-hotels-api) adapter activates with `SEARCHAPI_API_KEY` and is restricted to stays. It uses Google Hotels to find properties, then [Google Hotels Property](https://www.searchapi.io/docs/google-hotels-property-api) to obtain exact-date OTA rates and HTTPS booking links. The key is sent only in a server-side Bearer header. Each search run samples at most five destination/date combinations and checks up to three hotels per combination, stopping as soon as one returns eligible rates. This bounds the worst case at 20 SearchAPI requests. Only one-room searches with at most six guests and child ages 1–17 are supported; unsupported occupancies return no stay quote instead of changing the party. SearchAPI rates must echo the requested dates, currency and guests, and the final booking page must still be reconfirmed.

Ignav accepts passenger categories rather than every age. Children aged 2–11 are sent as children, ages 12–17 use the adult fare category, and children under two are split between own-seat and lap infants using the saved **Infants under 2 travelling on a lap** count. The resulting offer is still stored and matched against the original adults and child ages. Exact quotes expire from this app after 30 minutes and must be reconfirmed on the booking page.

Any additional live adapter must declare `liveRoundTripFlights: true`, return `Offer.journey: 'round-trip'`, `priceBasis: 'family-total'`, the exact dates and party, and set `booking.live: true` with a source quote reference, description and `linkKind: 'specific-offer'`. Its URL must open the individual quote. Stay quotes must identify the requested room count. Quote expiry is enforced.

Every saved search requires a **Target country**, selected from the full country dropdown. The backend loads that country’s cities in population order, resolves them through Ignav or Duffel, deduplicates the resulting IATA codes, and initially selects five concrete airports. The picker exposes up to 20 resolved airports so the user can deselect and replace airports while keeping a maximum of five. Searches persist and query those airport codes—not free-text city names. There is no “anywhere” mode. The airport mapping is cached for 24 hours. Choose **Edit search** to update any saved setting, including its name, departure, destination airports, dates, nights, travelers, rooms, currency, trip types, swimming preferences, and active status. The form opens with the current values; **Save changes** persists them and **Cancel** discards the edits. Changes to matching criteria clear the previous results; choose **Search now** after saving to collect new ones. Renaming or pausing/resuming preserves the collected results. Manual searches, flight + accommodation combinations, and daily collection all use the same filters.

Flight results retain up to the three cheapest verified purchase plans for each selected airport. With five selected airports, the UI and email digest can therefore show up to 15 flight variants rather than allowing one inexpensive airport to occupy the whole shortlist.

Country matching uses an explicit country from the offer, a country named in its destination, or the common city/resort aliases in `packages/shared/src/destinations.ts`. Country names support English, Romanian and ISO two-letter codes; city matching ignores case and accents and supports the catalog's aliases. Offers whose country cannot be identified are excluded when a country is selected. The city picker uses [countries.dev](https://countries.dev/cities-api), whose city data is derived from GeoNames under CC BY 4.0.

Free-text preferences are saved but there is no language model or automatic natural-language interpretation. Weather and swimming preferences are not yet scored or verified. Nearby airports are not inferred when the source only identifies one specific departure city.

## Run with Docker

Requires Docker Engine and Docker Compose v2.

1. Copy `.env.example` to `.env`.
2. Generate a password with `openssl rand -hex 24` and set `POSTGRES_PASSWORD` in `.env`.
3. Run:

```sh
docker compose up --build -d
```

Open <http://localhost:3000>. Email is disabled by default. Create an invitation:

```sh
docker compose exec api node dist/apps/api/src/invite.js person@example.com
```

Share the printed code privately with that person. They choose **Have an invitation? Join the group** and use the exact invited email. Codes expire after seven days and work once. The app does not send invitations automatically. Passwords must contain at least 12 characters. Sessions expire after 14 days. Password recovery is not implemented in this initial foundation; before a wider launch, add a mailbox-verified reset flow.

```sh
docker compose logs -f api worker
docker compose down
```

`down` preserves the database volume. Do not use `down -v` unless you intend to delete data.

## Monorepo

```text
apps/web           React + Vite frontend
apps/api           Fastify API, authentication, migrations, invitation CLI
apps/worker        Morning collection and Microsoft Graph digest
packages/shared    Search/offer validation, family matching, scheduling
packages/providers Source adapter contract and registry
infra              Caddy HTTPS proxy and database backup command
tests              Domain and database/API/worker integration coverage
```

The frontend is compiled to static assets and served by the API container. API and worker use the same Docker image with different entry points. PostgreSQL is also containerized. There are no cloud-specific services in the runtime path; move the Compose files, environment, and database backup to another Docker host to migrate.

## DigitalOcean deployment under $10/month

For the initial low-traffic group, the target is a **Basic Regular Droplet, 1 vCPU / 1 GiB, $6/month**. DigitalOcean's percentage-based daily backups add **30%, or $1.80/month**: **$7.80/month before taxes**. Reuse the existing `binarium.ro` domain and Microsoft 365 mailbox. This assumes those existing subscriptions are outside the app's incremental budget. Check the final regional/tax total in your account before creating resources.

Sources checked on 29 October 2026: [Droplet pricing](https://www.digitalocean.com/pricing/droplets), [backup pricing](https://docs.digitalocean.com/products/backups/details/pricing/).

The 1 GiB target is a constrained pilot configuration, not a capacity guarantee. Use HTTP extraction first, cache reusable source responses, and collect sequentially. Sustained Chromium crawling, paid proxies, paid travel APIs, and metered AI are outside this budget. Assess the actual source list before promising coverage or sizing. Build images locally or in CI to avoid memory pressure from compilation on the Droplet. An existing server with spare capacity may be cheaper; no existing DigitalOcean resources have been inspected or changed.

### Publish at travel.binarium.ro

This subdomain is a suggested configuration, not a DNS change already made.

1. Provision an EU Ubuntu Droplet with Docker/Compose. Allow inbound SSH, HTTP, and HTTPS; do not publish PostgreSQL.
2. Point an A record for `travel.binarium.ro` to the server. Add AAAA only if IPv6 is configured.
3. Copy the repository and `.env` onto the server using your normal deployment process. Restrict `.env` permissions with `chmod 600 .env`.
4. Set `NODE_ENV=production`, `APP_URL=https://travel.binarium.ro`, and `APP_HOST=travel.binarium.ro`. Keep email disabled until Graph is configured.
5. Build on your workstation or CI for the server's architecture (DigitalOcean Regular uses `linux/amd64`):

```sh
docker buildx build --platform linux/amd64 --load -t good-holiday-deals:local .
docker save good-holiday-deals:local | gzip > /tmp/good-holiday-deals-image.tar.gz
```

6. Transfer the archive to the server and load it:

```sh
gunzip -c /tmp/good-holiday-deals-image.tar.gz | docker load
docker compose --profile production up -d --no-build
```

Caddy obtains and renews HTTPS certificates. The API listens on loopback on the host; the database has no public port. If the server already has a reverse proxy, use it to reach `127.0.0.1:3000` instead of starting the Caddy profile, and explicitly configure its trusted address in `apps/api/src/app.ts` before rebuilding. The bundled Caddy has a fixed private address so forwarded rate-limit headers are trusted only from that proxy. Change the private subnet and trusted proxy address together if it conflicts with an existing network.

Watch memory, disk space, and logs after enabling sources. Source count, retention, and crawling concurrency must remain bounded. No cloud resources are provisioned by this repository.

## Microsoft 365 / Microsoft Graph

Use an unattended Entra application with access restricted to the chosen sender mailbox. Configure the application and mailbox through your Microsoft 365 administrator:

1. Register a single-tenant application in Microsoft Entra ID. Record tenant ID, client ID, and a client secret (its **value**, not its identifier).
2. Grant mailbox-scoped **Application Mail.Send** using Exchange Online Application RBAC. Test authorization for the intended sender and a different mailbox. Avoid retaining a parallel tenant-wide `Mail.Send` grant: the permissions are additive, so it would defeat the mailbox scope. Follow [Microsoft's Application RBAC setup](https://learn.microsoft.com/en-us/exchange/permissions-exo/application-rbac).
3. Configure these `.env` values on the host:

```dotenv
EMAIL_MODE=graph
GRAPH_TENANT_ID=your-tenant-id
GRAPH_CLIENT_ID=your-application-id
GRAPH_CLIENT_SECRET=your-secret-value
GRAPH_SENDER=your-existing-sender@binarium.ro
```

4. Recreate the services: `docker compose up -d --no-build`. Graph secrets are passed only to the worker, not the API or browser. Maintain and rotate the secret before expiry.

The worker uses the [client credentials flow](https://learn.microsoft.com/en-us/graph/auth-v2-service) and [Graph sendMail](https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0) over HTTPS. SMTP is unnecessary. It stores sent messages in the sender's Sent Items. A 202 response means Graph accepted the request; it does not prove delivery.

Each user with an active, unexpired search and daily email enabled gets one combined digest per local date. The worker polls each minute starting at 08:00; collection and delivery take additional time. A restart can catch up until noon local time. It does not send yesterday's missed digest after an overnight outage.

Database locks and a unique user/date key prevent concurrent duplicate jobs. Build/authentication failures can retry up to three times, at least five minutes apart. Sending is marked before the Graph request. Timeouts or crashes around submission are **not automatically retried**, because Graph may already have accepted the message. Inspect `digests` and Sent Items to resolve `sending`/`uncertain` records; this favors avoiding duplicate emails over guaranteed delivery. Users can pause email or individual searches in the app.

Digests include confirmed family totals and report provider failures. With `EMAIL_MODE=disabled`, the worker still collects eligible searches at the scheduled time and records `collected`, without sending email. **Search now** works independently of the worker and never sends email. Starting the development API/frontend does not start the worker; use `npm run dev:worker` in another terminal if you want morning collection locally. No real email is sent by the test suite.

## Adding travel sources

Add implementations of `TravelProvider` in `packages/providers/src/index.ts` and register them there. Before implementation, determine how to obtain a live price for the exact party, including ages at travel. Do not treat a per-adult advertised price as a verified family total.

Adapters must honor their abort signal (30 seconds by default), bound response sizes and concurrency, respect provider rate limits, and avoid bypassing logins, CAPTCHAs, or access controls. One database lock limits collection across API and worker processes; manual searches also have rate limits and a one-minute per-search cooldown. A failed source is recorded independently.

Confirmed offers require HTTPS booking links, source IDs, explicit currency, quote timestamp, party composition, travel dates, price basis, inclusions, and swimming evidence (or unknown). No currency conversion is guessed. Collection atomically replaces each search's snapshot; the UI only shows records checked in the last 48 hours.

## Backups and moving hosts

Enable the DigitalOcean backup plan in the control panel; Compose does not enable it. Also make a consistent logical database dump before upgrades and migrations:

```sh
sh infra/backup.sh
```

Copy the dump to a separate existing storage location. A dump on the same server is not an off-host backup. After starting a fresh empty database on a new host, restore with:

```sh
docker compose exec -T db pg_restore -U holiday -d holiday --no-owner --exit-on-error < backups/your-backup.dump
```

Restore before starting API/worker against the new database, then start them and create fresh HTTPS certificates on the new host. Preserve Graph configuration and `APP_URL`, update DNS, and stop the old worker before starting the new one. There must be one active database/scheduler deployment. Verify restored accounts/searches and test delivery before retiring the old server.

## Development and verification

Use Node 24+ and npm. Create an ignored `.env.local` with a generated hex password and matching local connection settings:

```dotenv
POSTGRES_PASSWORD=YOUR_GENERATED_HEX_PASSWORD
DATABASE_URL=postgres://holiday:YOUR_GENERATED_HEX_PASSWORD@localhost:5433/holiday
DEV_DB_PORT=5433
NODE_ENV=development
APP_URL=http://localhost:5173
PORT=3000
EMAIL_MODE=disabled
DIGEST_TIMEZONE=Europe/Bucharest
```

Start the development database with:

```sh
npm run dev:db
npm ci
```

The API, worker, and invitation commands load `.env`, then `.env.local`; local values override the file values in `.env`. Variables already exported in your shell take precedence over both files. Do not export production settings for local development. The database is bound to loopback on port 5433 by default, leaving port 5432 available for other projects. Run the API and frontend in separate terminals:

```sh
npm run dev:api
npm run dev:web
```

Open <http://localhost:5173> or <http://127.0.0.1:5173>. With a loopback `APP_URL` in development mode, the API accepts `localhost`, `127.0.0.1`, and `[::1]` origins on that exact frontend port and protocol. Production accepts only the configured origin. Browser sessions are hostname-specific, so sign in again when switching between localhost and 127.0.0.1.

For a local invitation: `npm run invite -- person@example.com`. Share the printed code privately and join using that email. Stop the API/frontend with Ctrl+C; stop the database with `docker compose --env-file .env --env-file .env.local -f compose.yaml -f compose.dev.yaml stop db`.

```sh
npm run typecheck
npm test
npm run build
```

To run the database/API/worker integration test, point `TEST_DATABASE_URL` at a **disposable database** and run `npm test`. It creates tables/test accounts and mocks Graph requests. Tests cover invitation consumption, session revocation, cross-user data isolation, morning scheduling, digest deduplication, and uncertain submissions in addition to family/date/currency filtering and source failures.
