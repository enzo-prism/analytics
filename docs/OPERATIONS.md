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

The production service account is the authorization boundary. A property being
visible to a human Google account does not make it visible to the dashboard.

## Add a property

1. In Google Analytics, grant the production service account **Viewer** access at
   the account level. Use property-level Viewer access only when account access is
   unavailable.
2. Confirm the property has a `WEB_DATA_STREAM` with a populated default URL.
3. If `GA_PROPERTY_ALLOWLIST` is configured, append the numeric property ID.
4. Confirm the ID is not present in `GA_PROPERTY_BLOCKLIST`.
5. Refresh `/api/dashboard?window=d7`. No source edit is required for discovery.

Viewer is the intended least-privilege role. Email notifications are unnecessary
for service accounts. Never commit or print the service-account private key.

## Why an accessible property may not render

- The production service account does not have access.
- The property has no web stream or the web stream has no default URL.
- The property is excluded by an environment allowlist or blocklist.
- A newer property uses the same normalized domain and supersedes it.
- Google returned a permanent property-level API error.

## Local verification

```bash
npm ci
npm run lint
npx tsc --noEmit
npm run build
```

Exercise the dashboard at desktop, tablet, and mobile widths. Verify search,
status filters, sorting, pagination, reporting-window changes, property detail,
and the accessible trend table. Check for horizontal overflow and browser-console
errors.

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
8. Load the production UI and verify the same totals and property count render.

Keep Git state, build state, deployment state, and live data readback distinct in
release notes.
