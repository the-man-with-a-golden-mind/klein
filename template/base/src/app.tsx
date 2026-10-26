import { BootstrapContext, type Bootstrap } from "./bootstrap";
import { Shell } from "./components/layout/Shell";
import { PAGE_IDS, PAGES, PageView } from "./pages/registry";
import { PageRoute } from "./routes/PageRoute";
import { Router, Routes, useLocation, type Route } from "./router";

// Built once at module level so route components keep stable identities (no remounts per render).
const ROUTES: Route[] = PAGE_IDS.map((id) => ({
  pattern: new URLPattern({ pathname: PAGES[id].path }),
  component: () => <PageRoute id={id} />,
}));
const NotFoundRoute = () => <PageRoute id="not-found" />;
const isPage = (path: string) => ROUTES.some(({ pattern }) => pattern.test({ pathname: path }));

function BrowserTree() {
  const { path } = useLocation();
  return (
    <Shell path={path}>
      <Routes routes={ROUTES} fallback={NotFoundRoute} />
    </Shell>
  );
}

export function App({ server, ...bootstrap }: Bootstrap & { server?: boolean }) {
  return (
    <BootstrapContext.Provider value={bootstrap}>
      {server ? (
        // The server already knows the page; it doesn't use the router.
        <Shell path={new URL(bootstrap.initialUrl, "http://local").pathname}>
          <PageView page={bootstrap.page} />
        </Shell>
      ) : (
        <Router handles={isPage}>
          <BrowserTree />
        </Router>
      )}
    </BootstrapContext.Provider>
  );
}
