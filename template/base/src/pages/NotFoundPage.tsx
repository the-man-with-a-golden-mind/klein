import { Link } from "../components/Link";

export function NotFoundPage() {
  return (
    <section class="space-y-4">
      <h1 class="text-3xl font-semibold tracking-tight">Page not found</h1>
      <p>There is nothing at this address.</p>
      <p>
        <Link href="/" class="underline underline-offset-4">
          Go to the home page
        </Link>
      </p>
    </section>
  );
}
