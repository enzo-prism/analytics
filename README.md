# GA4 New Users Dashboard

A dark-mode portfolio dashboard for comparing GA4 new users across websites. It
uses a read-only service account, discovers eligible properties automatically,
and renders one responsive card per unique website.

## What it tracks

- Current versus previous-period `newUsers` for 1, 7, 28, 90, 180, or 365 days.
- A deliberately minimal overview with refresh, reporting-window, and status controls only.
- Fully clickable property cards showing the property name, current new users, and
  current-versus-prior change.
- Every property matching the active status filter in one responsive grid, with
  no client-side search, user-selectable sorting, or pagination.
- Per-property daily trend charts with accessible tabular data.
- Property-local reporting windows ending on the last completed day.

## Visual semantics

The dashboard is intentionally neutral by default. Raw current totals use the
primary foreground; raw previous-period totals use a muted neutral. Current and
previous chart series use solid white and dashed gray lines, respectively, and
the accessible trend table follows the same neutral hierarchy.

Green and red are reserved for changes that clear both a rate gate and a
seven-day-normalized user-impact gate:

- Positive: at least `+15%` and `+10` normalized users.
- Negative: at most `-20%` and `-10` normalized users.
- Critical: at most `-40%` and `-20` normalized users, or a drop to zero from
  at least `10` normalized previous users.

The normalized impact is `delta × 7 ÷ reporting-window days`, which keeps the
materiality standard consistent across 1-, 7-, 28-, 90-, 180-, and 365-day
views. Changes below those gates remain neutral even though the Growing and
Declining filters still reflect their actual direction. The red priority signal
renders only for a critical decline. Normal current/loading status is neutral;
red is used for blocking connection failures and other issues that need action.
A failed refresh remains muted when a last successful result is still available.

## Prereqs

1. Create a Google Cloud project.
2. Enable the APIs:
   - Google Analytics Data API
   - Google Analytics Admin API
3. Create a service account and download a JSON key.
4. In Google Analytics, add the service account email as a **Viewer** at each
   account level that should appear in the portfolio. Account-level access is
   preferred because newly created properties are then discovered automatically.

## Environment variables

Copy `.env.example` to `.env.local` and fill in:

```
GA_CLIENT_EMAIL=
GA_PRIVATE_KEY=
GA_PROPERTY_ALLOWLIST=
GA_PROPERTY_BLOCKLIST=
```

Notes:
- `GA_PRIVATE_KEY` should include escaped newlines (`\n`) if stored in a single line.
- `GA_PROPERTY_ALLOWLIST` is optional (comma-separated property IDs).
- `GA_PROPERTY_BLOCKLIST` is optional (comma-separated property IDs to hide in
  addition to the permanent exclusions below).
- Leave `GA_PROPERTY_ALLOWLIST` unset to discover every property visible to the
  service account.

### Permanent property exclusions

The source-managed `HIDDEN_PROPERTY_IDS` set is applied before dashboard totals,
cards, or detail responses are created. It currently excludes:

- `518332323` — Saorsa Website

This removes the property from the web app without deleting or modifying the
underlying Google Analytics property. Use `GA_PROPERTY_BLOCKLIST` for temporary
or deployment-specific exclusions.

## Property discovery

The dashboard reads all GA4 account summaries visible to the service account,
then keeps properties that:

1. Are not excluded by the source-managed hidden-property set or the environment
   allowlist/blocklist configuration.
2. Have a web data stream with a default website URL.
3. Are queried for a `newUsers` report through the GA Data API. Permanent report
   failures remain visible as data issues instead of removing the property.

When multiple properties use the same normalized website URL, the newest numeric
property ID is kept so portfolio totals do not double-count the same site. A
property with no default web-stream URL is intentionally omitted.

## Local development

```bash
npm ci
npm run dev
```

Open `http://localhost:3000`.

## Deploy to Vercel

1. Set the env vars in Vercel (`GA_CLIENT_EMAIL`, `GA_PRIVATE_KEY`, optional allowlist,
   optional blocklist).
2. Run `npm run lint`, `npx tsc --noEmit`, and `npm run build`.
3. Push the verified commit to `main` and deploy or promote that exact commit.
4. Read back `/api/dashboard?window=d7` and the rendered production dashboard.
   Verify raw values and current/previous series remain neutral, gated changes
   receive the correct semantic tone, and only critical declines render the red
   priority signal.

See [Production operations](docs/OPERATIONS.md) for the complete access,
verification, and release checklist.

The application does not implement its own sign-in layer. Protect the production
deployment with Vercel deployment protection or another access control if the
portfolio must remain private.

## API

`GET /api/dashboard?window=d1|d7|d28|d90|d180|d365`

Returns the current + previous window new users for each GA4 web property.

`GET /api/properties/{propertyId}?window=d1|d7|d28|d90|d180|d365`

Returns one property's summary and daily current/previous series.

`GET /api/total?window=d7|d30|d60|d90|d365`

Returns the deduplicated portfolio total and error count.

`GET /api/njo-sites?period=last30|last90|ytd|all`

Live GA4 + Search Console payload for Dr. Njo’s two marketing sites only:
`michaelnjodds.com` (property `516211709` / `G-6HWEE040EH`) and
`practicetransitionsinstitute.com` (property `502361992` / `G-XCBKH87HG5`).
GA4 rows are filtered to production hostnames. Search Console uses the domain
properties. CORS is limited to the Njo executive dashboard origins. The Njo
dashboard at `https://njo-dashboard.vercel.app` reads this endpoint.

Date windows end on the last completed day in each GA4 property's reporting
timezone. When multiple properties point at the same normalized website domain,
the dashboard and total endpoints consistently use the newest property ID.
Transient Google API throttling, server errors, and network stalls use short,
bounded retries with per-request timeouts.

## Loading and cache behavior

- The default 7-day dashboard is rendered with cached data in the initial HTML,
  so the browser does not wait for hydration before showing property cards.
- Dashboard, total, and property-detail results are cached by their validated
  window/property inputs for 60 seconds. Ignored query parameters do not create
  another full Google Analytics refresh.
- The slow-changing property inventory is shared across report windows: account
  summaries are cached for 15 minutes and property metadata for 60 minutes.
- Edge responses can serve cached data while revalidating for up to 24 hours.
  Client views preserve existing values when a background refresh fails.
- Automatic refresh runs every five minutes only while the tab is visible.
  Property-route prefetching is disabled, and the detail chart loads separately
  from the client code that starts the data request.

## Troubleshooting

- Permission errors: confirm the service account is a Viewer at the GA account level.
- Missing properties: compare the work-user and service-account inventories, check
  `HIDDEN_PROPERTY_IDS`, `GA_PROPERTY_ALLOWLIST`, and `GA_PROPERTY_BLOCKLIST`, then
  confirm the property has a web data stream with a default URL.
- Missing duplicate: a newer property with the same normalized domain may have
  replaced the older property intentionally.
- Private key issues: ensure `GA_PRIVATE_KEY` uses `\n` for newlines in Vercel.
- Partial data: requests retry bounded 429/5xx failures, while permanent property
  errors remain visible under the Data issues filter and on the affected card.
