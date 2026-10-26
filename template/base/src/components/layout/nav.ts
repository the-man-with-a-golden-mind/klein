export interface NavEntry {
  href: string;
  label: string;
}

export const NAV: NavEntry[] = [
  { href: "/", label: "Home" },
  { href: "/notes", label: "Notes" },
  { href: "/guestbook", label: "Guestbook" },
];

export function isActive(entry: NavEntry, path: string): boolean {
  return entry.href === "/" ? path === "/" : path === entry.href || path.startsWith(`${entry.href}/`);
}
