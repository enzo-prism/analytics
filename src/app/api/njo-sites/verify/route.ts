import { JWT } from "google-auth-library";
import { NextResponse } from "next/server";
import { NJO_SITES, type NjoSiteConfig } from "@/lib/njo-sites";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const GSC_BASE = "https://searchconsole.googleapis.com/webmasters/v3";
const SITE_VERIFY_BASE = "https://www.googleapis.com/siteVerification/v1";
const GSC_WRITE_SCOPE = "https://www.googleapis.com/auth/webmasters";
const SITE_VERIFY_SCOPE = "https://www.googleapis.com/auth/siteverification";

type VerifyMethod = "FILE" | "META";

const getAccessToken = async (): Promise<string> => {
  const email = process.env.GA_CLIENT_EMAIL;
  const privateKeyRaw = process.env.GA_PRIVATE_KEY;
  if (!email || !privateKeyRaw) {
    throw new Error("Missing GA_CLIENT_EMAIL or GA_PRIVATE_KEY.");
  }
  const client = new JWT({
    email,
    key: privateKeyRaw.replace(/\\n/g, "\n"),
    scopes: [GSC_WRITE_SCOPE, SITE_VERIFY_SCOPE],
  });
  const tokenResponse = await client.getAccessToken();
  const token =
    typeof tokenResponse === "string" ? tokenResponse : tokenResponse.token;
  if (!token) {
    throw new Error("Unable to authorize the Google service account.");
  }
  return token;
};

const googleFetch = async (
  url: string,
  token: string,
  init: RequestInit,
): Promise<{ ok: boolean; status: number; body: string }> => {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(init.headers ?? {}),
    },
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.text();
  return { ok: response.ok, status: response.status, body };
};

const getToken = async (
  token: string,
  identifier: string,
  method: VerifyMethod,
): Promise<{ ok: boolean; token?: string; error?: string }> => {
  const result = await googleFetch(`${SITE_VERIFY_BASE}/token`, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      site: { type: "SITE", identifier },
      verificationMethod: method,
    }),
  });
  if (!result.ok) {
    return { ok: false, error: `${result.status} ${result.body.slice(0, 800)}` };
  }
  try {
    const parsed = JSON.parse(result.body) as { token?: string };
    if (!parsed.token) {
      return { ok: false, error: "No token in response." };
    }
    return { ok: true, token: parsed.token };
  } catch {
    return { ok: false, error: result.body };
  }
};

const insertVerification = async (
  token: string,
  identifier: string,
  method: VerifyMethod,
): Promise<{ ok: boolean; error?: string }> => {
  const result = await googleFetch(
    `${SITE_VERIFY_BASE}/webResource?verificationMethod=${method}`,
    token,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ site: { type: "SITE", identifier } }),
    },
  );
  if (!result.ok) {
    return { ok: false, error: `${result.status} ${result.body.slice(0, 800)}` };
  }
  return { ok: true };
};

const addGscSite = async (
  token: string,
  siteUrl: string,
): Promise<{ ok: boolean; error?: string }> => {
  const result = await googleFetch(
    `${GSC_BASE}/sites/${encodeURIComponent(siteUrl)}`,
    token,
    { method: "PUT" },
  );
  if (!result.ok) {
    return { ok: false, error: `${result.status} ${result.body.slice(0, 800)}` };
  }
  return { ok: true };
};

const listGscSites = async (token: string): Promise<string[]> => {
  const result = await googleFetch(`${GSC_BASE}/sites`, token, { method: "GET" });
  if (!result.ok) {
    return [];
  }
  try {
    const parsed = JSON.parse(result.body) as {
      siteEntry?: { siteUrl?: string }[];
    };
    return (parsed.siteEntry ?? [])
      .map((entry) => entry.siteUrl)
      .filter((url): url is string => Boolean(url));
  } catch {
    return [];
  }
};

const verifySite = async (token: string, site: NjoSiteConfig) => {
  const identifier = `${site.url.replace(/\/$/, "")}/`;
  const methods: VerifyMethod[] = ["META", "FILE"];
  const tokens: Record<string, string | null> = { META: null, FILE: null };
  const errors: string[] = [];
  let verified = false;

  for (const method of methods) {
    const issued = await getToken(token, identifier, method);
    if (!issued.ok || !issued.token) {
      errors.push(`${method} token: ${issued.error ?? "missing"}`);
      continue;
    }
    tokens[method] = issued.token;
    const inserted = await insertVerification(token, identifier, method);
    if (inserted.ok) {
      verified = true;
      break;
    }
    errors.push(`${method} insert: ${inserted.error ?? "failed"}`);
  }

  if (verified) {
    const addedPrefix = await addGscSite(token, identifier);
    if (!addedPrefix.ok) {
      errors.push(`sites.add prefix: ${addedPrefix.error ?? "failed"}`);
    }
    const addedDomain = await addGscSite(token, site.gscSiteUrl);
    if (!addedDomain.ok) {
      errors.push(`sites.add domain: ${addedDomain.error ?? "failed"}`);
    }
  }

  const listed = (await listGscSites(token)).filter((url) =>
    url.toLowerCase().includes(site.domain.toLowerCase()),
  );

  return {
    id: site.id,
    domain: site.domain,
    identifier,
    verified,
    listed,
    metaToken: tokens.META,
    fileToken: tokens.FILE,
    errors,
  };
};

export async function GET() {
  try {
    const token = await getAccessToken();
    const sites = [];
    for (const site of NJO_SITES) {
      sites.push(await verifySite(token, site));
    }
    return NextResponse.json(
      { ok: sites.every((site) => site.listed.length > 0), sites },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: message },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
