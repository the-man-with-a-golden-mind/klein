import type { ComponentChildren } from "preact";
import { useContext } from "preact/hooks";
import { BootstrapContext } from "../../bootstrap";
import { Link } from "../Link";
import { isActive, NAV } from "./nav";

/** Frame around every page: site name, menu and the content column. */
export function Shell({ path, children }: { path: string; children: ComponentChildren }) {
  const { site } = useContext(BootstrapContext);
  return (
    <div class="mx-auto flex min-h-screen max-w-2xl flex-col px-5">
      <header class="flex items-baseline justify-between gap-6 py-8">
        <Link href="/" class="text-lg font-semibold tracking-tight">
          {site.name}
        </Link>
        <nav aria-label="Main">
          <ul class="flex gap-5">
            {NAV.map((entry) => {
              const active = isActive(entry, path);
              return (
                <li key={entry.href}>
                  <Link
                    href={entry.href}
                    aria-current={active ? "page" : undefined}
                    class={active ? "underline underline-offset-4" : "text-muted hover:text-foreground"}
                  >
                    {entry.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </header>
      <main id="main" tabIndex={-1} class="flex-1 pb-16 leading-relaxed outline-none">
        {children}
      </main>
    </div>
  );
}
