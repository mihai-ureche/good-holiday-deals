# Good Holiday Deals

A private travel notebook for an invited group. Save flexible family searches, collect offers from source adapters, compare prices, and receive one morning digest at **08:00 Europe/Bucharest**, including summer time. Book directly with the provider.

## Current state

The foundation includes single-use email-bound invitations, password sign-in, private saved searches, family composition, flexible dates/nights, nearby-airport and swimming preferences, a sortable deals view, PostgreSQL storage, and a daily Microsoft Graph email worker. The UI distinguishes packages, flights, and stays and compares one currency at a time. Prices are stored as integer minor units.

**Nine public offer integrations are connected:** Vola.ro, Travelminit.ro, ChristianTour.ro, DirectBooking.ro, Momondo.ro, Skyscanner.ro, Kiwi.com, KAYAK, and Cheapflights. Save a search, then choose **Search now** to collect public promotions immediately, including when email is disabled. The first check can take up to five minutes; public pages are cached for 30 minutes. The source panel lists all requested sites and which integrations remain pending. See [source coverage and limitations](docs/sources.md).

Public promotions retain their original price basis and currency. Known departure cities, dates/date windows, nights, trip types, and currencies are filtered; unknown dates or occupancy stay explicitly unconfirmed. No mock data is presented as live offers. The new Bucharest-specific flight landing-page adapters skip other departure cities; KAYAK also exposes promotions from other Romanian cities where available.

### Flight + accommodation

Include **Flights** and **Stays** in the search and select the number of rooms. After **Search now**, open **Deals worth a look → Flight + accommodation**. Choose **Total for all travelers** or **Average per person**. Each combination includes separate flight/stay links and a cost breakdown, and can use different flight and hotel providers.

The engine pairs the same destination (including a small explicit city-alias map) and currency. Compatible, fresh, party-specific flight and stay quotes with exactly matching dates can produce a **sum of quoted totals**. Public fares and nightly hotel rates produce **illustrative budgets**, with a range for the requested nights and explicit assumptions: equal airfares for adults and children; a return leg at the same fare where no return price is supplied; selected rooms at the advertised nightly rate. KAYAK homepage hotel cards do not state their rate basis, so interpreting them as room/night is itself a visible budgeting assumption. Unspecified-basis hotel adverts are excluded from calculations. No currency conversion is inferred. Average per person divides the group budget and does not assert equal individual charges.

Budget estimates are not live availability checks or bookable package quotes. Dates, room occupancy, baggage, transfers, taxes, flight arrival times, and final prices need provider confirmation. Flights and stays are booked separately. The same combinations and assumptions are included in daily emails. Existing searches default to one room; create a new search to select another room count.

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

Digests distinguish confirmed family totals from advertised starting prices and include any unavailable source IDs. With `EMAIL_MODE=disabled`, the worker still collects eligible searches at the scheduled time and records `collected`, without sending email. **Search now** works independently of the worker and never sends email. Starting the development API/frontend does not start the worker; use `npm run dev:worker` in another terminal if you want morning collection locally. No real email is sent by the test suite.

## Adding travel sources

Add implementations of `TravelProvider` in `packages/providers/src/index.ts` and register them there. Source URLs are server-controlled; users cannot supply arbitrary crawl URLs. Before implementation, determine whether the website has an accessible feed or API, its crawling requirements, and how to obtain a price for the exact party, including ages at travel. Do not treat a per-adult advertised price as a verified family total.

Adapters must honor their abort signal (30 seconds per source), bound response sizes and concurrency, respect source access rules/rate limits, and avoid bypassing logins, CAPTCHAs, or access controls. The public HTTP client checks robots.txt for each page and redirect, blocks cross-origin redirects, limits bodies to 3 MiB, enforces per-origin spacing/crawl delay, and caches pages for 30 minutes and rules for six hours. Sources and crawled URLs are fixed in code. One database lock limits collection across API and worker processes; manual searches also have rate limits and a one-minute per-search cooldown. A failed source is recorded independently.

Confirmed offers require HTTPS booking links, source IDs, explicit currency, quote timestamp, party composition, travel dates, price basis, inclusions, and swimming evidence (or unknown). Public discoveries use a separate schema/table that preserves unknown occupancy, dates and price basis. No currency conversion is guessed. Collection atomically replaces each search's snapshot; the UI only shows records checked in the last 48 hours. A cached result retains its original check time.

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
