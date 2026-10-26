import { Link } from "../components/Link";

export function HomePage(_: { data: undefined }) {
  return (
    <article class="space-y-4">
      <h1 class="text-3xl font-semibold tracking-tight">Hello</h1>
      <p>
        This page is rendered on the server, hydrated in the browser, and every link after this one is a client-side
        navigation that fetches only data.
      </p>
      <p>
        <Link href="/notes" class="underline underline-offset-4 hover:text-muted">
          Read the notes →
        </Link>
      </p>
    </article>
  );
}
