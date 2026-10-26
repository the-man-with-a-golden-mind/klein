import { useEffect, useState } from "preact/hooks";

export type RemoteData<T> =
  | { status: "loading" }
  | { status: "ok"; data: T }
  | { status: "not-found" }
  | { status: "unauthorized" }
  | { status: "error" };

/**
 * Fetches JSON from `url` (null = don't fetch). Results are keyed by URL, so a new URL reads
 * as "loading" on the very first render instead of briefly showing the previous result.
 */
export function useRemoteData<T>(url: string | null): RemoteData<T> {
  const [state, setState] = useState<{ url: string; result: RemoteData<T> } | null>(null);

  useEffect(() => {
    if (url === null) return;
    const controller = new AbortController();
    const settle = (result: RemoteData<T>) => {
      if (!controller.signal.aborted) setState({ url, result });
    };
    fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } })
      .then(async (response) => {
        if (response.status === 404) return settle({ status: "not-found" });
        if (response.status === 401) return settle({ status: "unauthorized" });
        if (!response.ok) return settle({ status: "error" });
        settle({ status: "ok", data: (await response.json()) as T });
      })
      .catch(() => settle({ status: "error" }));
    return () => controller.abort();
  }, [url]);

  return state && state.url === url ? state.result : { status: "loading" };
}
