import { NoteDate } from "../components/NoteDate";
import { useUser } from "../hooks/useUser";
import type { AccountData } from "../shared/types";

// Example of a page only signed-in people see (`auth: "required"` in the registry): its loader gets the
// session, and its data is never cached publicly. Signing out is a plain form, so it works without JavaScript.

const PROVIDERS: Record<string, string> = { github: "GitHub", google: "Google" };

export function AccountPage({ data }: { data: AccountData }) {
  const user = useUser();
  const providers = data.providers.map((p) => PROVIDERS[p] ?? p).join(", ");
  return (
    <section class="space-y-10">
      <header class="space-y-2">
        <h1 class="text-3xl font-semibold tracking-tight">Account</h1>
        <p class="text-muted">
          Signed in as {user?.name} with {providers}.
        </p>
      </header>

      <section class="space-y-4">
        <h2 class="text-xl font-semibold">Where you're signed in</h2>
        <ul class="space-y-3">
          {data.sessions.map((s, i) => (
            <li key={i} class="space-y-0.5">
              <p>
                {describeDevice(s.userAgent)}
                {s.current ? <span class="text-muted"> · this browser</span> : null}
              </p>
              <p class="text-sm text-muted">
                Signed in <NoteDate iso={s.createdAt} />, last active <NoteDate iso={s.lastSeenAt} />
              </p>
            </li>
          ))}
        </ul>
      </section>

      <form method="post" action="/auth/sign-out" class="flex flex-wrap gap-3">
        <button type="submit" class="rounded bg-foreground px-4 py-2 font-medium text-background">
          Sign out
        </button>
        <button type="submit" name="everywhere" value="1" class="rounded border border-muted/40 px-4 py-2 font-medium">
          Sign out everywhere
        </button>
      </form>
    </section>
  );
}

/** "Firefox on macOS" from a User-Agent header. Rough on purpose; it's only a hint for the person. */
function describeDevice(userAgent: string | null): string {
  if (!userAgent) return "Unknown device";
  const browser = [["Edg/", "Edge"], ["Firefox/", "Firefox"], ["Chrome/", "Chrome"], ["Safari/", "Safari"]].find(([m]) => userAgent.includes(m!))?.[1];
  const os = [["iPhone", "iPhone"], ["iPad", "iPad"], ["Android", "Android"], ["Mac OS", "macOS"], ["Windows", "Windows"], ["Linux", "Linux"]].find(([m]) => userAgent.includes(m!))?.[1];
  if (browser && os) return `${browser} on ${os}`;
  return browser ?? os ?? "Unknown device";
}
