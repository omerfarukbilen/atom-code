---
name: frontend-design
description: Build distinctive, production-grade user interfaces - layout, visual hierarchy, spacing and type scales, color and WCAG AA contrast, dark mode, responsive design, restrained motion, complete component states, and accessibility (semantic HTML, keyboard, ARIA). Use when creating or restyling a page, component, dashboard, landing page or design system in React, Vue, Svelte, Tailwind or plain CSS, or when a UI looks generic, cluttered, inaccessible or broken on mobile.
---

# Frontend Design

Good interfaces are not decorated; they are *decided*. Every size, color and gap should exist for a reason the
user can feel: what to look at first, what is clickable, what belongs together, what just happened. This skill
turns that into a process you can apply to anything from a single button to a full application.

## When to use

- Building a new screen, component, landing page, dashboard, settings panel, form or empty state.
- Restyling or "making it look better / more professional / less generic".
- Introducing or extending design tokens (colors, spacing, type) or a component library.
- Fixing contrast, focus, keyboard, responsive or dark-mode problems.

Not for: pure data-visualization design choices (chart type, palettes for series), backend work, or native mobile
UI toolkits (the principles transfer, the code does not). Slow renders, large bundles and Core Web Vitals belong to
`atom:performance-optimization`; React error boundaries and error-message content to `atom:error-handling`.

## Step 1 - Read the existing system before designing

In an existing product, consistency beats novelty. A beautiful component that ignores the app's tokens is a bug.

- Glob for `tailwind.config.*`, `**/tokens.*`, `**/theme.*`, `**/*.css` with `:root`, `components/ui/**`.
- Grep for the CSS custom properties or Tailwind theme keys already in use (`--color-`, `--space-`, `bg-`, `text-`).
- Identify the component library (shadcn/ui, Radix, MUI, Chakra, Headless UI, Vuetify...) and use its primitives -
  they already solve focus management and ARIA correctly.
- Open two or three existing screens (Read the components) and note: radius, shadow style, density, icon set,
  font, how buttons and inputs look. Reuse those.

Only when there is no system (greenfield) do you choose one. Then do it deliberately (Step 2).

## Step 2 - Choose a direction (greenfield or redesign)

Write down, in two or three sentences, who uses this and the feeling it should have: "dense, keyboard-driven tool
for engineers - calm, technical, high information density" is a design brief; "modern and clean" is not.

Then commit to a small number of decisions and apply them everywhere:

- **One typeface family** for UI (two at most: e.g. a display face for headings + a workhorse for text, or a
  sans + a mono for code-heavy tools). System stack is a respectable choice for tools.
- **A neutral ramp + one accent color + semantic colors** (success, warning, danger, info). Most of the UI is
  neutrals; the accent marks the primary action and current state. Restraint is what makes the accent work.
- **A radius and elevation language**: e.g. 6px radius, borders for separation, shadows only for floating layers.
- **A density**: compact (tools, tables), comfortable (consumer apps), spacious (marketing).

### Avoid the generic "AI-generated" look

These patterns signal that nobody made a decision. Do not use them by default:

- Purple-to-blue gradients, gradient text headings, glowing blobs in the background.
- Everything centered; a hero with a vague headline, a subtitle, two buttons, then three identical feature cards
  with emoji or generic icons.
- Glassmorphism, heavy drop shadows and `rounded-2xl` applied to every element equally.
- Every element the same visual weight - no clear primary action, no hierarchy.
- Lorem ipsum or "Feature 1 / Feature 2" placeholder copy. Write real, specific copy for the product's domain.
- Decorative animation on everything (fade-up on scroll for each section).

Distinctive design comes from specifics: real content, a considered type pairing, an unexpected but disciplined
accent, purposeful asymmetry, details like tabular numbers in tables and well-crafted empty states.

## Step 3 - Lay out with hierarchy and rhythm

**Visual hierarchy** is controlled by size, weight, color/contrast, spacing and position. Use the fewest levers
needed: de-emphasizing secondary text (muted color) usually works better than making the primary text huge.

- Each view has one primary action. Secondary actions are visually quieter (outline/ghost), destructive actions are
  separated and confirmed.
- Group related things by **proximity**: space inside a group is smaller than space between groups. If you need a
  border or a box to show grouping, the spacing is probably wrong.
- Align to a grid. Left-aligned text is easier to scan than centered text for anything longer than a heading.
- Limit line length for prose to about 45-75 characters (`max-width: 65ch`).

**Spacing scale** - pick one and never use values outside it (4px base):

```
4  8  12  16  24  32  48  64  96   (px)  ->  Tailwind: 1 2 3 4 6 8 12 16 24
```

**Type scale** - a modular scale with a fixed set of sizes and matched line heights:

| Role | Size / line-height | Weight |
| --- | --- | --- |
| Caption, labels | 12/16 | 500 |
| Secondary text | 14/20 | 400 |
| Body | 16/24 | 400 |
| Subheading | 18/28 or 20/28 | 600 |
| Section heading | 24/32 | 600 |
| Page title | 30/36 to 36/40 | 700 |
| Display (marketing) | 48/52+ | 700-800, slight negative tracking |

Use `font-variant-numeric: tabular-nums` for numbers in tables, timers and prices so columns do not jitter.

Token sets you can copy (CSS variables and Tailwind): [references/design-tokens.md](references/design-tokens.md).

## Step 4 - Color, contrast and dark mode

- Use **semantic tokens** in components (`--color-bg`, `--color-surface`, `--color-fg`, `--color-fg-muted`,
  `--color-border`, `--color-accent`, `--color-danger`), never raw hex values. Themes then swap token values only.
- **WCAG 2.2 AA contrast**: 4.5:1 for normal text, 3:1 for large text (24px+, or 18.66px+ bold), 3:1 for
  UI component boundaries, focus indicators and meaningful icons/graphics. Muted text is where designs usually fail -
  check placeholder text, disabled-looking-but-enabled controls and text on accent backgrounds.
- **Never encode meaning with color alone**: pair the red border with an icon and an error message; pair status
  dots with a label.
- **Dark mode is a second design, not an inversion.** Use dark gray surfaces (not pure `#000`), make elevated
  surfaces *lighter* (shadows are invisible on dark), reduce accent saturation slightly, and avoid pure white body
  text on near-black (use ~90% lightness) to reduce glare. Set `color-scheme: light dark` so native controls and
  scrollbars follow the theme.

```css
:root {
  color-scheme: light dark;
  --color-bg: #ffffff;  --color-surface: #f6f7f9;  --color-fg: #111827;  --color-fg-muted: #4b5563;
  --color-border: #d1d5db;  --color-accent: #2453d6;  --color-accent-fg: #ffffff;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --color-bg: #0f1115;  --color-surface: #181b21;  --color-fg: #e6e8eb;  --color-fg-muted: #9aa3ae;
    --color-border: #2b3039;  --color-accent: #7c9bff;  --color-accent-fg: #0b1020;
  }
}
:root[data-theme="dark"] { /* same values as the media query block, for an explicit user choice */ }
```

## Step 5 - Responsive layout

- **Mobile first**: write the base styles for narrow screens, then add `min-width` breakpoints. Choose breakpoints
  where the *content* breaks, not at device widths.
- Prefer intrinsic layouts that need no breakpoints:
  `grid-template-columns: repeat(auto-fit, minmax(min(16rem, 100%), 1fr));` and flex with `flex-wrap`.
- Use **container queries** (`container-type: inline-size` + `@container (min-width: 30rem)`) for components that
  live in panels of varying width - the component adapts to its slot, not the viewport.
- Fluid type for marketing headings: `font-size: clamp(2rem, 1.2rem + 3vw, 3.5rem);`. Keep UI text fixed-size.
- Touch targets at least 24x24 CSS px (WCAG 2.2 AA), 44x44 recommended for primary touch controls.
- Test at 320px width: no horizontal scroll, no clipped text, no overlapping fixed elements. Tables become
  scrollable containers (`overflow-x: auto` on a wrapper) or stacked cards.
- Use `min-height: 100dvh` instead of `100vh` for full-height mobile layouts (the dynamic viewport accounts for
  browser chrome).

## Step 6 - Motion with restraint

Motion should explain change (where did that panel come from, what got deleted), never decorate.

- Durations: 100-150ms for micro-interactions (hover, press), 200-300ms for panels and dialogs. Longer feels slow.
- Easing: ease-out for entering, ease-in for exiting, ease-in-out for moving on screen.
- Animate `transform` and `opacity` only; animating `width`, `height`, `top` or `box-shadow` causes layout/paint jank.
- Respect reduced motion - remove movement, keep instant state changes:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important; scroll-behavior: auto !important; }
}
```

## Step 7 - Design every state

A component is not done when the happy path looks good. Enumerate and implement:

| State | Requirement |
| --- | --- |
| Default | Clear affordance: buttons look pressable, links look like links |
| Hover | Subtle change (background tint), only on devices that hover: `@media (hover: hover)` |
| Focus-visible | Visible ring with 3:1 contrast, offset from the element; never `outline: none` without a replacement |
| Active / pressed | Immediate feedback (slight darken or 1px translate) |
| Selected / current | Distinct from hover; use `aria-current` / `aria-selected` / `aria-pressed` as appropriate |
| Disabled | Reduced contrast plus `disabled` attribute; explain *why* nearby if not obvious. Prefer enabled + validation message over mysterious disabled buttons |
| Loading | Skeletons for content areas (matching final layout, no layout shift); spinner + disabled for buttons; keep the label width stable |
| Empty | Explain what will appear here and offer the action that fills it ("No projects yet - Create project") |
| Error | Say what happened and how to recover, near the cause; keep user input intact; offer retry |
| Overflow | Long names, 0 items, 10,000 items, long words: truncate with `title`/tooltip, wrap with `overflow-wrap: anywhere`, virtualize or paginate |

## Step 8 - Accessibility is part of the design

- **Semantic HTML first**: `<button>` for actions, `<a href>` for navigation, `<label for>` for every input,
  headings in order (`h1` then `h2`...), landmarks (`header`, `nav`, `main`, `footer`), `<ul>` for lists, `<table>`
  for tabular data. Native elements give you keyboard support and screen-reader semantics for free.
- **Keyboard**: everything clickable is reachable with Tab in a logical order and operable with Enter/Space;
  Escape closes overlays; focus moves into a dialog when it opens, stays trapped inside, and returns to the trigger
  when it closes (the native `<dialog>` element with `showModal()` does most of this). Never use positive `tabindex`.
- **ARIA only when HTML cannot express it** (the first rule of ARIA). A `div` with `role="button"` needs
  `tabindex="0"` and key handlers - just use `<button>`. Use ARIA for real gaps: `aria-expanded` on disclosure
  triggers, `aria-live="polite"` for async status messages, `aria-describedby` linking inputs to errors,
  `aria-label` on icon-only buttons.
- Images: meaningful images get descriptive `alt`; decorative ones get `alt=""`. Icon-only buttons need an
  accessible name.
- Forms: visible labels (placeholders are not labels), `autocomplete` attributes, errors announced and linked.

```tsx
// Bad: div soup, no name, no keyboard, color-only error
<div className="btn" onClick={save}><Icon name="save" /></div>
<input placeholder="Email" style={{ borderColor: error ? "red" : undefined }} />

// Good
<button type="button" onClick={save} aria-label="Save draft"><SaveIcon aria-hidden="true" /></button>
<label htmlFor="email">Email</label>
<input id="email" type="email" autoComplete="email" aria-invalid={!!error}
       aria-describedby={error ? "email-error" : undefined} />
{error && <p id="email-error" className="text-danger"><AlertIcon aria-hidden="true" /> {error}</p>}
```

## Framework notes

**React**
- Build components with a small, typed variant API (`variant="primary" | "secondary" | "ghost"`, `size`) rather
  than passing arbitrary class strings everywhere. Spread remaining native props (`...props`) so `aria-*`, `type`,
  and event handlers work.
- In React 19, `ref` is a regular prop for function components; on React 18 and earlier use `forwardRef` so
  consumers can focus your inputs and buttons.
- Use `useId()` to link labels, descriptions and error messages.

**Tailwind**
- Extend the theme with your tokens (or, in v4, define them in `@theme`) and use the resulting classes; a codebase
  full of arbitrary values like `p-[13px] text-[#3b3b3b]` has no system.
- Compose classes with `clsx` + `tailwind-merge` (often exported as `cn()`) and model variants with
  `class-variance-authority` if the project uses it.
- Dark mode: `dark:` variants. v3 uses `darkMode: 'class'` (or `'selector'`) in the config for a manual toggle;
  v4 uses `@custom-variant dark (&:where(.dark, .dark *));` in CSS. Check which version the project runs first.
- Use `focus-visible:` (not `focus:`) for rings, `motion-safe:` / `motion-reduce:` for animation.

**Plain CSS**
- Custom properties for tokens, `:focus-visible` for focus styles, logical properties (`margin-inline`,
  `padding-block`) for RTL support, `:where()` to keep base-style specificity low, `@layer` to order resets,
  base and components.

## Verification

1. Check `mcp__atom-ide__get_diagnostics` for the files you edited (type and lint errors, including
   `eslint-plugin-jsx-a11y` findings if configured).
2. Run the project's linter/type checker (`npm run lint`, `npx tsc --noEmit`, etc.).
3. View the UI at 320px, 768px and 1280px+, in light and dark mode, and with reduced motion. If you cannot view
   it yourself, tell the user exactly what to check.
4. Keyboard-only walkthrough: Tab through every control, operate it, open and close every overlay.
5. Automated a11y scan when a dev server is running: `npx @axe-core/cli http://localhost:5173` or
   `npx lighthouse http://localhost:5173 --only-categories=accessibility --view`.
6. Walk the full checklist: [references/ui-checklist.md](references/ui-checklist.md).

## Definition of done

- [ ] Uses the project's existing tokens/components (or a deliberate new token set), no stray magic values.
- [ ] Clear hierarchy: one primary action per view, related items grouped by spacing.
- [ ] Text and UI contrast meet WCAG AA in light and dark themes.
- [ ] All states implemented: hover, focus-visible, active, disabled, loading, empty, error, overflow.
- [ ] Works at 320px without horizontal scroll; touch targets adequate.
- [ ] Fully keyboard operable with visible focus; semantic HTML; ARIA only where needed and correct.
- [ ] Motion is purposeful, uses transform/opacity, and honors `prefers-reduced-motion`.
- [ ] Real, specific copy - no lorem ipsum, no generic AI-template layout.
