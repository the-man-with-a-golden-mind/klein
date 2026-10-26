import { createContext } from "preact";
import type { ResolvedPage } from "./pages/registry";
import type { SiteInfo, User } from "./shared/types";

/** Server data embedded in the page as `#app[data-bootstrap]` and read once by the browser. */
export interface Bootstrap {
  page: ResolvedPage;
  /** pathname + search of the server-rendered URL; the browser reuses `page` for it. */
  initialUrl: string;
  site: SiteInfo;
  /** The signed-in user (--auth), else null. Pages with a user are never publicly cached. */
  user: User | null;
}

export const BootstrapContext = createContext<Bootstrap>(null as unknown as Bootstrap);

// base64url keeps the attribute free of quotes, `<` and `&`, so no escaping is needed.
export function encodeBootstrap(bootstrap: Bootstrap): string {
  const bytes = new TextEncoder().encode(JSON.stringify(bootstrap));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeBootstrap(encoded: string): Bootstrap {
  const binary = atob(encoded.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes)) as Bootstrap;
}
