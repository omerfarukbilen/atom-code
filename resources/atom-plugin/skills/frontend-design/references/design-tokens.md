# Design token starter sets

Use these only when the project has no token system. If it has one, extend it in the same style. All color pairs
below were chosen to meet WCAG AA for their intended use; re-check any value you change.

Token naming principle: **name by role, not by appearance** (`--color-danger`, not `--color-red`). Components refer
only to role tokens, so a theme is just a different set of values.

## 1. CSS custom properties (framework-agnostic)

```css
@layer tokens {
  :root {
    color-scheme: light dark;

    /* Typography */
    --font-sans: "Inter var", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    --font-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    --text-xs: 0.75rem;   --leading-xs: 1rem;      /* 12/16 */
    --text-sm: 0.875rem;  --leading-sm: 1.25rem;   /* 14/20 */
    --text-base: 1rem;    --leading-base: 1.5rem;  /* 16/24 */
    --text-lg: 1.125rem;  --leading-lg: 1.75rem;   /* 18/28 */
    --text-xl: 1.25rem;   --leading-xl: 1.75rem;   /* 20/28 */
    --text-2xl: 1.5rem;   --leading-2xl: 2rem;     /* 24/32 */
    --text-3xl: 1.875rem; --leading-3xl: 2.25rem;  /* 30/36 */
    --text-4xl: 2.25rem;  --leading-4xl: 2.5rem;   /* 36/40 */

    /* Spacing (4px base) */
    --space-1: 0.25rem; --space-2: 0.5rem;  --space-3: 0.75rem; --space-4: 1rem;
    --space-6: 1.5rem;  --space-8: 2rem;    --space-12: 3rem;   --space-16: 4rem; --space-24: 6rem;

    /* Shape and elevation */
    --radius-sm: 4px; --radius-md: 6px; --radius-lg: 10px; --radius-full: 9999px;
    --shadow-popover: 0 4px 12px rgb(0 0 0 / 0.08), 0 1px 3px rgb(0 0 0 / 0.06);
    --shadow-dialog: 0 16px 48px rgb(0 0 0 / 0.16);

    /* Motion */
    --duration-fast: 120ms; --duration-base: 200ms; --duration-slow: 300ms;
    --ease-out: cubic-bezier(0.2, 0, 0, 1); --ease-in: cubic-bezier(0.4, 0, 1, 1);

    /* Color - light */
    --color-bg: #ffffff;
    --color-surface: #f6f7f9;          /* cards, sidebars */
    --color-surface-raised: #ffffff;   /* popovers, dialogs */
    --color-fg: #111827;               /* 17.7:1 on bg */
    --color-fg-muted: #4b5563;         /* 7.6:1 on bg  */
    --color-fg-subtle: #6b7280;        /* 4.8:1 on bg - minimum for text */
    --color-border: #d1d5db;           /* decorative separators */
    --color-border-strong: #8a929e;    /* input borders: >= 3:1 on bg */
    --color-accent: #2453d6;           /* primary buttons, links */
    --color-accent-hover: #1c43b3;
    --color-accent-fg: #ffffff;        /* 6.4:1 on accent */
    --color-focus: #2453d6;
    --color-success: #13795b;  --color-warning: #a15c07;  --color-danger: #c4291c;  --color-info: #0b6aa2;
  }

  /* Dark values: apply via media query unless the user forced light, and via explicit attribute. */
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --color-bg: #0f1115;  --color-surface: #161920;  --color-surface-raised: #1d2129;
      --color-fg: #e6e8eb;  --color-fg-muted: #9aa3ae;  --color-fg-subtle: #858e9a;
      --color-border: #2b3039;  --color-border-strong: #5c6573;
      --color-accent: #7c9bff;  --color-accent-hover: #9bb3ff;  --color-accent-fg: #0b1020;
      --color-focus: #9bb3ff;
      --color-success: #4cc79a;  --color-warning: #f0b45b;  --color-danger: #ff7b6e;  --color-info: #5fb8f0;
      --shadow-popover: 0 4px 12px rgb(0 0 0 / 0.5);
    }
  }
  :root[data-theme="dark"] {
    --color-bg: #0f1115;  --color-surface: #161920;  --color-surface-raised: #1d2129;
    --color-fg: #e6e8eb;  --color-fg-muted: #9aa3ae;  --color-fg-subtle: #858e9a;
    --color-border: #2b3039;  --color-border-strong: #5c6573;
    --color-accent: #7c9bff;  --color-accent-hover: #9bb3ff;  --color-accent-fg: #0b1020;
    --color-focus: #9bb3ff;
    --color-success: #4cc79a;  --color-warning: #f0b45b;  --color-danger: #ff7b6e;  --color-info: #5fb8f0;
    --shadow-popover: 0 4px 12px rgb(0 0 0 / 0.5);
  }
}

/* Base focus style used everywhere */
:where(a, button, input, select, textarea, [tabindex]):focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
}
```

Avoid a flash of the wrong theme by setting the attribute before the stylesheet paints:

```html
<script>
  try { const t = localStorage.getItem("theme"); if (t) document.documentElement.dataset.theme = t; } catch {}
</script>
```

## 2. Tailwind CSS v4 (`@theme` in CSS)

```css
@import "tailwindcss";
@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));

@theme {
  --font-sans: "Inter var", ui-sans-serif, system-ui, sans-serif;
  --color-bg: var(--app-bg);
  --color-surface: var(--app-surface);
  --color-fg: var(--app-fg);
  --color-fg-muted: var(--app-fg-muted);
  --color-border: var(--app-border);
  --color-accent: var(--app-accent);
  --color-accent-fg: var(--app-accent-fg);
  --radius-md: 6px;
}
/* Define --app-* values for light and dark exactly like section 1, then use bg-surface, text-fg-muted, etc. */
```

## 3. Tailwind CSS v3 (`tailwind.config.ts`)

```ts
import type { Config } from "tailwindcss";

export default {
  darkMode: "class", // or "selector" (3.4.1+); toggles on a .dark class on <html>
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "var(--color-bg)",
        surface: "var(--color-surface)",
        fg: { DEFAULT: "var(--color-fg)", muted: "var(--color-fg-muted)" },
        border: "var(--color-border)",
        accent: { DEFAULT: "var(--color-accent)", fg: "var(--color-accent-fg)" },
        danger: "var(--color-danger)",
      },
      borderRadius: { md: "6px" },
      fontFamily: { sans: ["Inter var", "ui-sans-serif", "system-ui", "sans-serif"] },
    },
  },
} satisfies Config;
```

## 4. A button built on the tokens (React + Tailwind + cva)

```tsx
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils"; // clsx + tailwind-merge

const button = cva(
  "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors " +
    "focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg " +
    "disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "bg-accent text-accent-fg hover:bg-accent/90",
        secondary: "border border-border bg-surface text-fg hover:bg-fg/5",
        ghost: "text-fg hover:bg-fg/5",
        danger: "bg-danger text-white hover:bg-danger/90",
      },
      size: { sm: "h-8 px-3 text-sm", md: "h-9 px-4 text-sm", lg: "h-11 px-6 text-base" },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

type ButtonProps = React.ComponentProps<"button"> & VariantProps<typeof button> & { loading?: boolean };

export function Button({ className, variant, size, loading, disabled, children, ...props }: ButtonProps) {
  return (
    <button
      type="button"
      className={cn(button({ variant, size }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && <Spinner className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
      {children}
    </button>
  );
}
```

Notes: opacity modifiers such as `bg-accent/90` on `var()`-based colors work out of the box in Tailwind v4 (it uses
`color-mix()`); in v3 define the colors as `rgb(var(--color-accent-rgb) / <alpha-value>)` with space-separated RGB
channels in the variable, or use dedicated hover tokens instead. `type="button"` prevents accidental form submits (consumers can still pass `type="submit"`); the spinner is
hidden from assistive tech while `aria-busy` communicates the state; the label stays in place so the width does
not jump.
