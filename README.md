# GA4 New Users Dashboard

Minimal internal dashboard for tracking GA4 new users across web properties using a
service account (no OAuth).

## Prereqs

1. Create a Google Cloud project.
2. Enable the APIs:
   - Google Analytics Data API
   - Google Analytics Admin API
3. Create a service account and download a JSON key.
4. IMPORTANT: In Google Analytics (signed in as enzo@design-prism.com), add the
   service account email as a Viewer at the ACCOUNT level(s) so it can read all
   properties/websites.

## Environment variables

Copy `.env.example` to `.env.local` and fill in:

```
GA_CLIENT_EMAIL=
GA_PRIVATE_KEY=
GA_PROPERTY_ALLOWLIST=
GA_PROPERTY_BLOCKLIST=
DASHBOARD_PASSWORD=
```

Notes:
- `GA_PRIVATE_KEY` should include escaped newlines (`\n`) if stored in a single line.
- `GA_PROPERTY_ALLOWLIST` is optional (comma-separated property IDs).
- `GA_PROPERTY_BLOCKLIST` is optional (comma-separated property IDs to hide).
- `DASHBOARD_PASSWORD` is optional; when set, Basic Auth is required for `/` and `/api/*`
  (any username, password must match).

## Local development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Deploy to Vercel

1. Set the env vars in Vercel (`GA_CLIENT_EMAIL`, `GA_PRIVATE_KEY`, optional allowlist,
   optional password).
2. Deploy the project.

## API

`GET /api/dashboard?window=d1|d7|d28`

Returns the current + previous window new users for each GA4 web property.

## Troubleshooting

- Permission errors: confirm the service account is a Viewer at the GA account level.
- Missing properties: check `GA_PROPERTY_ALLOWLIST` and confirm the property has a web
  data stream.
- Private key issues: ensure `GA_PRIVATE_KEY` uses `\n` for newlines in Vercel.
