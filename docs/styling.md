# Styling

Styles are written with [Tailwind CSS v4](https://tailwindcss.com). The Tailwind CLI builds them
into `public/assets/styles.css`. There's no PostCSS config and no plugin to set up.

## The entry file: `src/styles/app.css`

```css
@import "tailwindcss" source(none);
@source "../";                    /* scan src/ for class names */

@theme {
  --color-background: #faf8f5;
  --color-foreground: #1f1a17;
  --color-muted: #6b625b;
  --font-sans: "Inter", "Inter Fallback", ui-sans-serif, system-ui, sans-serif;
}

@media (prefers-color-scheme: dark) {
  :root { --color-background: #171412; --color-foreground: #ede8e3; --color-muted: #a39a92; }
}
```

Tailwind turns each `--color-*` token into utility classes, so `--color-muted` gives you
`text-muted`, `bg-muted`, `border-muted/40` and so on. In components, use these token classes
rather than raw colours. Then changing the palette, or adding a theme, is an edit to this one file
instead of a search through every component.

Dark mode follows the operating system setting. The tokens get new values under
`prefers-color-scheme: dark`, and that's all. As long as components use tokens, they don't need any
`dark:` variants.

## Building

| Command | What it does |
| --- | --- |
| `bun run build:css` | a single minified build; `dev`, `build` and `deploy` run it for you |
| `bun run dev:css` | rebuilds whenever something changes; leave it running while you add classes |

Tailwind only generates the classes it finds in `src/`. It finds them by reading your files as plain
text, so it can only spot class names written out in full. `active ? "underline" : "text-muted"`
works. `` `text-${color}` `` doesn't, because the full class name never appears anywhere in your code.

## No inline styles

The Content Security Policy says `style-src 'self'`, and that **blocks `style="…"` attributes** in the
HTML the server sends. A test fails if any page renders one. Here's what to do instead.

Most of the time, a class does the job: `class={wide ? "max-w-4xl" : "max-w-2xl"}`.

For a value that really is dynamic, like a progress bar, set a CSS custom property from JavaScript
after the page has hydrated, with `element.style.setProperty("--progress", "42%")`. The CSP only
cares about `style` attributes in the HTML. Changing styles from script is still allowed.

If you need a handful of fixed values, a few utility classes for exactly those values work as well.

## Fonts

Inter is served from your own site, out of `public/assets/fonts/`. It's the Latin subset as a
variable font, with its OFL licence next to it, and the HTML head preloads it.

While the font loads, the browser shows a fallback. Normally the fallback has different letter
widths, so when Inter arrives the text reflows and the page jumps. To avoid that, the fallback is
Arial, adjusted to take up the same space as Inter:

```css
@font-face {
  font-family: "Inter Fallback";
  src: local("Arial"), local("ArialMT");
  size-adjust: 107.12%;
  ascent-override: 90.44%;
  descent-override: 22.52%;
  line-gap-override: 0%;
}
```

To use a different font, put its `woff2` file in `public/assets/fonts/`, update the `@font-face` and
the preload `<link>` in `src/ssr.tsx`, and work out new fallback numbers for that font. Tools like
[Fontaine](https://github.com/unjs/fontaine) can calculate them, or you can borrow the values
published for `next/font`.

Characters that aren't in the subset, like →, ↗ or emoji, come from system fonts, so they may look
slightly different from the text around them.

## Layout

`src/components/layout/Shell.tsx` is the frame around every page: the site name, the menu (built from
`nav.ts`, with `aria-current="page"` on the current entry) and a `<main id="main">` column where
pages are rendered. It's ordinary Preact, so change it however you like.
