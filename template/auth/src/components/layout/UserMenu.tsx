import { signInPath } from "../../shared/auth";
import { useUser } from "../../hooks/useUser";
import { Link } from "../Link";

/** "Sign in" for visitors, the person's name (linking to /account) once signed in. */
export function UserMenu({ path }: { path: string }) {
  const user = useUser();
  const style = path === "/account" ? "underline underline-offset-4" : "text-muted hover:text-foreground";
  // /auth/* isn't a page, so the router lets the browser follow this link to the provider.
  if (!user) return <a href={signInPath(path)} class={style}>Sign in</a>;
  return (
    <Link href="/account" aria-current={path === "/account" ? "page" : undefined} class={style}>
      {user.name}
    </Link>
  );
}
