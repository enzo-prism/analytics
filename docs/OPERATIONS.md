# Production operations

Production target:

- Vercel project: `analytics`
- Canonical URL: `https://analytics-neon-zeta.vercel.app/`

The app has no built-in authentication middleware. If portfolio data should not
be public, enable Vercel deployment protection or an equivalent access layer
before sharing the URL.

## Data flow

The user story is:

`dashboard page → Next.js API route → GA Admin API property discovery → GA Data API newUsers report → normalized response → property cards and detail charts`

Dr. Njo’s owner dashboard is a separate app (`njo-dashboard`). It loads live
GA4 and Search Console for PTI and michaelnjodds.com from:

`GET /api/njo-sites?period=last30|last90|ytd|all`

That route uses the same service account. Grant the service account **Viewer**
on both GA4 properties and **Full** (or at least Restricted) user access on both
Search Console properties for those domains (domain property or URL-prefix).
The Njo endpoint lists Search Console sites the service account can see and
uses the matching property for each domain, so either `sc-domain:` or
`https://www.example.com/` works once the account is added. If Search Console
is missing, GA4 still returns; GSC metrics show as Pending instead of fake zeros.

The production service account is the authorization boundary. A property being
visible to a human Google account does not make it visible to the dashboard.

The default 7-day response is server-rendered from the application data cache.
Validated dashboard windows and property IDs are the cache keys, so unrelated
query parameters cannot trigger another full Google refresh. Account summaries
are cached for 15 minutes, property metadata for 60 minutes, and report results
for 60 seconds. CDN responses may remain available during background
revalidation for up to 24 hours.

## Add a property

1. In Google Analytics, grant the production service account **Viewer** access at
   the account level. Use property-level Viewer access only when account access is
   unavailable.
2. Confirm the property has a `WEB_DATA_STREAM` with a populated default URL.
3. If `GA_PROPERTY_ALLOWLIST` is configured, append the numeric property ID.
4. Confirm the ID is not present in the source-managed `HIDDEN_PROPERTY_IDS` set
   or `GA_PROPERTY_BLOCKLIST`.
5. Refresh `/api/dashboard?window=d7`. No source edit is required for discovery.

Viewer is the intended least-privilege role. Email notifications are unnecessary
for service accounts. Never commit or print the service-account private key.

## Remove a property from the web app

Use the source-managed `HIDDEN_PROPERTY_IDS` set for a permanent product decision.
Use `GA_PROPERTY_BLOCKLIST` for a temporary or deployment-specific exclusion.
Both mechanisms remove the property from dashboard cards and totals, and direct
detail requests return `Property is excluded from the dashboard.` Neither
mechanism deletes or modifies the underlying Google Analytics property.

The permanent exclusion registry currently contains:

- `518332323` — Saorsa Website

When changing the registry, add or update a regression test, run the local
verification suite, and read back both `/api/dashboard?window=d7` and the direct
property endpoint in production.

## Why an accessible property may not render

- The production service account does not have access.
- The property has no web stream or the web stream has no default URL.
- The property is excluded by `HIDDEN_PROPERTY_IDS` or an environment allowlist
  or blocklist.
- A newer property uses the same normalized domain and supersedes it.
- Google returned a permanent property-level API error.

## Local verification

```bash
npm ci
npm run lint
npx tsc --noEmit
npm run build
npm run test:e2e
```

Exercise the dashboard at desktop, tablet, and mobile widths. Confirm the visible
top row contains only refresh and reporting-window controls; the overview has no
visible branding/title/timestamp, summary tiles, search, user-selectable sort, or
pagination. Verify every matching property renders in one responsive grid and
each card shows only its property name, new-user value, and previous-period
comparison while still opening its detail page. Verify status and reporting-window
changes, property detail, and the accessible trend table. On mobile, verify compact
cards, multi-line names, safe-area spacing, 44px minimum control targets, no
horizontal overflow, and no browser-console errors.

### Semantic color verification

Treat color as operational meaning, not decoration:

- Current raw totals are foreground white; previous raw totals are muted gray.
- The trend chart uses a solid foreground line for Current and a dashed muted
  line for Previous. The accessible table uses the same neutral hierarchy.
- A change is green only at `>= +15%` and `>= +10` seven-day-normalized users.
- A change is red at `<= -20%` and `<= -10` seven-day-normalized users.
- A decline is critical at `<= -40%` and `<= -20` seven-day-normalized users,
  or when current users are zero after at least `10` normalized previous users.
- Normalize impact as `delta × 7 ÷ reporting-window days`. Both gates are
  inclusive, so test the exact boundaries as well as just-under-boundary values.
- The red priority banner appears only for critical declines. Growing and
  Declining filters remain directional and may include neutrally toned changes.
- Data-current and loading statuses are neutral. A blocking connection failure
  is red; a refresh failure that preserves usable data is muted.
- An unavailable percentage (`n/a`) is muted even if the absolute delta has a
  semantic tone.

At 320px width and browser zoom, expand the accessible trend table and confirm
it scrolls horizontally inside its own container without widening the page.

## Release checklist

1. Confirm the branch is `main` and is even with `origin/main` before release work.
2. Review `git diff` and exclude `.env*`, `.vercel`, reports, screenshots, and
   other scratch artifacts.
3. Run the complete local verification commands.
4. Commit and push the exact verified tree to `origin/main`.
5. Deploy that commit to the Vercel `analytics` production project.
6. Confirm the production deployment is `READY` and mapped to
   `https://analytics-neon-zeta.vercel.app/`.
7. Read `/api/dashboard?window=d7` and verify:
   - `updatedAt` is fresh;
   - property count matches the service-account/web-stream/dedupe result;
   - error count is expected;
   - aggregate new users equal the sum of rendered property responses.
8. Load the production overview and verify the minimal chrome, property count,
   complete card grid, and status filter. Open at least one card and verify its
   detail trend and accessible table.
9. Exercise fixtures or known properties on both sides of each semantic color
   threshold. Confirm raw totals never inherit trend colors, the chart legend
   matches the solid/dashed series, normal status stays neutral, and only a
   critical decline produces the red priority banner.
10. Inspect a fresh production load and confirm the overview does not prefetch
    every `/properties/*?_rsc=` route. Change a detail reporting window and
    confirm it issues one property API request without an RSC navigation.
11. Compare a canonical API request with the same validated `window` plus a
    harmless extra query parameter. The outer CDN may miss, but the normalized
    application cache should prevent another multi-property Google fan-out.

Keep Git state, build state, deployment state, and live data readback distinct in
release notes.
