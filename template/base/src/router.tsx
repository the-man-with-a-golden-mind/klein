// Our own tiny client router: history-backed location, link interception, URLPattern matching.
import { createContext, type ComponentChildren, type ComponentType } from "preact";
import { useContext, useEffect, useMemo, useState } from "preact/hooks";
import { decodeParams } from "./shared/params";

export interface Location {
  url: string; // pathname + search
  /** True until the first client-side navigation: the page on screen is the one the server rendered. */
  initial: boolean;
  path: string;
  query: URLSearchParams;
  navigate: (href: string, options?: { replace?: boolean }) => void;
}

const LocationContext = createContext<Location>(null as unknown as Location);

export const useLocation = () => useContext(LocationContext);

const currentUrl = () => location.pathname + location.search;

/**
 * `handles(path)` says which paths are client-side pages. Links to anything else (/auth/*, /media/*,
 * /sitemap.xml…) are left to the browser as normal navigations.
 */
export function Router({ children, handles }: { children: ComponentChildren; handles: (path: string) => boolean }) {
  const [state, setState] = useState(() => ({ url: currentUrl(), initial: true }));
  const go = () => setState({ url: currentUrl(), initial: false });

  const value = useMemo<Location>(() => {
    const parsed = new URL(state.url, "http://local");
    return {
      url: state.url,
      initial: state.initial,
      path: parsed.pathname,
      query: parsed.searchParams,
      navigate(href, options = {}) {
        history[options.replace ? "replaceState" : "pushState"](null, "", href);
        go();
        scrollTo(0, 0);
      },
    };
  }, [state]);

  useEffect(() => {
    const onPopState = go;

    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.target || anchor.hasAttribute("download")) return;
      const target = new URL(anchor.href);
      if (target.origin !== location.origin || !handles(target.pathname)) return;
      // Same page with a #hash (e.g. the skip link): let the browser jump.
      if (target.hash && target.pathname === location.pathname && target.search === location.search) return;
      event.preventDefault();
      value.navigate(target.pathname + target.search + target.hash);
    };

    addEventListener("popstate", onPopState);
    document.addEventListener("click", onClick);
    return () => {
      removeEventListener("popstate", onPopState);
      document.removeEventListener("click", onClick);
    };
  }, [value, handles]);

  return <LocationContext.Provider value={value}>{children}</LocationContext.Provider>;
}

export interface Route {
  pattern: URLPattern;
  component: ComponentType<{ params: Record<string, string> }>;
}

/** Renders the first route whose pattern matches the current path, else `fallback`. */
export function Routes({ routes, fallback: Fallback }: { routes: Route[]; fallback: ComponentType }) {
  const { path } = useLocation();
  for (const { pattern, component: Component } of routes) {
    const match = pattern.exec({ pathname: path });
    if (!match) continue;
    const params = decodeParams(match.pathname.groups);
    return params ? <Component params={params} /> : <Fallback />;
  }
  return <Fallback />;
}

