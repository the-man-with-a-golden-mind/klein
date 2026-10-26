import type { AnchorHTMLAttributes } from "preact";

/** A plain <a>. The router intercepts same-origin clicks, so this needs no client logic. */
export function Link(props: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a {...props} />;
}
