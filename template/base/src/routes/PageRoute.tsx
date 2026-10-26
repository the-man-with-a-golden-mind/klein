import { useContext, useEffect } from "preact/hooks";
import { BootstrapContext } from "../bootstrap";
import { useRemoteData } from "../hooks/useRemoteData";
import { ErrorPage } from "../pages/ErrorPage";
import { signInPath } from "../shared/auth";
import { documentTitle, PAGES, PageView, pageTitle, type PageId, type ResolvedPage } from "../pages/registry";
import { useLocation } from "../router";

/**
 * Generic browser route. On hydration it reuses the server's data (no fetch). After any client-side
 * navigation, data pages fetch /api/page (fresh data, e.g. after a form post) and render nothing while loading.
 */
export function PageRoute({ id }: { id: PageId | "not-found" }) {
  const { url, initial } = useLocation();
  const { page: initialPage, initialUrl, site } = useContext(BootstrapContext);

  const reuse = initial && url === initialUrl;
  const needsFetch = !reuse && id !== "not-found" && PAGES[id].hasData;
  const remote = useRemoteData<ResolvedPage>(needsFetch ? `/api/page?path=${encodeURIComponent(url)}` : null);

  let page: ResolvedPage | null;
  if (reuse) page = initialPage;
  else if (id === "not-found") page = { id };
  else if (!needsFetch) page = { id, data: undefined };
  else if (remote.status === "ok") page = remote.data;
  else if (remote.status === "not-found") page = { id: "not-found" };
  else page = null; // loading or error

  const failed = needsFetch && remote.status === "error";
  const mustSignIn = needsFetch && remote.status === "unauthorized";
  const title = page ? documentTitle(pageTitle(page), site.name) : failed ? documentTitle("Error", site.name) : null;

  useEffect(() => {
    if (title !== null) document.title = title;
  }, [title]);

  // An auth: "required" page without a session: sign in (a full navigation), then come back here.
  useEffect(() => {
    if (mustSignIn) location.assign(signInPath(url));
  }, [mustSignIn, url]);

  if (failed) return <ErrorPage />;
  return page ? <PageView page={page} /> : null;
}
