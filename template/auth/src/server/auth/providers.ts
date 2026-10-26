// OAuth 2 providers: authorization code flow with PKCE, plain fetch, no SDKs.
// To add one, copy a provider below; register `<origin>/auth/callback` as its redirect URL.

export interface Profile {
  id: string; // stable id at the provider, never the email
  name: string;
}

export interface OAuthProvider {
  id: string; // stored in accounts.provider
  label: string; // "GitHub"
  /** Environment variable prefix for the error shown when credentials are missing. */
  env: string;
  clientId: string | undefined;
  clientSecret: string | undefined;
  authorizeUrl: string;
  tokenUrl: string;
  scope: string;
  profile(accessToken: string, fetcher: typeof fetch): Promise<Profile>;
}

interface Credentials {
  clientId: string | undefined;
  clientSecret: string | undefined;
}

const TIMEOUT_MS = 10_000;

async function getJson<T>(fetcher: typeof fetch, url: string, init: RequestInit): Promise<T> {
  const response = await fetcher(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return (await response.json()) as T;
}

const displayName = (...candidates: (string | null | undefined)[]) =>
  (candidates.find((c) => typeof c === "string" && c.trim() !== "") ?? "Unnamed").trim().slice(0, 100);

/** GitHub OAuth app: github.com → Settings → Developer settings → OAuth Apps. One callback URL per app. */
export function github({ clientId, clientSecret }: Credentials): OAuthProvider {
  return {
    id: "github",
    label: "GitHub",
    env: "GITHUB",
    clientId,
    clientSecret,
    authorizeUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    scope: "read:user",
    async profile(accessToken, fetcher) {
      const user = await getJson<{ id: number; login: string; name: string | null }>(fetcher, "https://api.github.com/user", {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "klein-auth", // GitHub's API rejects requests without one
        },
      });
      return { id: String(user.id), name: displayName(user.name, user.login) };
    },
  };
}

/** Google OAuth client: console.cloud.google.com → APIs & Services → Credentials → OAuth client ID (Web). */
export function google({ clientId, clientSecret }: Credentials): OAuthProvider {
  return {
    id: "google",
    label: "Google",
    env: "GOOGLE",
    clientId,
    clientSecret,
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scope: "openid profile",
    async profile(accessToken, fetcher) {
      const user = await getJson<{ sub: string; name?: string; given_name?: string }>(
        fetcher,
        "https://openidconnect.googleapis.com/v1/userinfo",
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      return { id: user.sub, name: displayName(user.name, user.given_name) };
    },
  };
}

/** Exchanges the authorization code (+ PKCE verifier) for an access token. */
export async function exchangeCode(
  provider: OAuthProvider,
  fetcher: typeof fetch,
  params: { code: string; verifier: string; redirectUri: string },
): Promise<string> {
  const body = await getJson<{ access_token?: string; error?: string }>(fetcher, provider.tokenUrl, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: params.code,
      redirect_uri: params.redirectUri,
      client_id: provider.clientId ?? "",
      client_secret: provider.clientSecret ?? "",
      code_verifier: params.verifier,
    }),
  });
  // GitHub answers 200 with { error } for bad codes.
  if (!body.access_token) throw new Error(`token exchange failed: ${body.error ?? "no access_token"}`);
  return body.access_token;
}
