# UI review checklist

Walk this list before calling a UI change done, or when reviewing someone else's UI. Each item is phrased as a
question you can answer yes/no by reading the code or looking at the screen. Items marked (AA) map to WCAG 2.2
Level AA success criteria.

## 1. Consistency with the system

- [ ] Colors, spacing, radii, shadows and font sizes come from existing tokens/theme, not ad-hoc values.
- [ ] Existing components (Button, Input, Dialog, Menu...) are reused instead of re-implemented.
- [ ] Icons come from the project's icon set, at consistent sizes (e.g. 16/20/24) and stroke width.
- [ ] Terminology matches the rest of the product (same verb for the same action everywhere).

## 2. Hierarchy and layout

- [ ] The most important information/action is the most visually prominent; squinting at the screen confirms it.
- [ ] Exactly one primary button per view or dialog.
- [ ] Spacing between groups is larger than spacing within groups; values are on the spacing scale.
- [ ] Elements align to a consistent grid/edges; no near-misses of 1-3px.
- [ ] Prose line length is at most ~75 characters.
- [ ] Headings form a logical outline (`h1` > `h2` > `h3`, no skipped levels for styling reasons).

## 3. Typography

- [ ] At most two font families; sizes come from the type scale.
- [ ] Body text is at least 16px on content pages (14px acceptable in dense tools); line-height 1.4-1.6 for body.
- [ ] Numbers in tables and counters use tabular figures.
- [ ] Text can be resized to 200% without loss of content or function (AA 1.4.4); no fixed heights clipping text.
- [ ] Long words/URLs wrap or truncate gracefully (`overflow-wrap: anywhere`, `text-overflow: ellipsis` + full
      value available on hover/focus).

## 4. Color and contrast

- [ ] Normal text contrast >= 4.5:1; large text >= 3:1 (AA 1.4.3).
- [ ] Input borders, focus rings, icons that convey meaning, and chart elements >= 3:1 against adjacent colors (AA 1.4.11).
- [ ] Placeholder text, disabled-looking text and text on colored backgrounds were explicitly checked.
- [ ] Information is never conveyed by color alone (AA 1.4.1): errors have text/icons, links in body text are
      underlined or otherwise distinguishable.
- [ ] Components use semantic tokens so both themes work.

## 5. Dark mode

- [ ] Every surface, border, text and icon color has a dark value (no hard-coded `#fff` / `#000` / `bg-white`).
- [ ] Elevation is shown by lighter surfaces, not shadows alone.
- [ ] Images/illustrations/logos remain visible (transparent PNGs with dark strokes vanish on dark backgrounds).
- [ ] `color-scheme` is set so native inputs, scrollbars and date pickers match.
- [ ] Theme preference persists and there is no flash of the wrong theme on load (set the theme attribute before
      first paint, e.g. inline script in `<head>`).

## 6. Responsive behavior

- [ ] No horizontal scrolling at 320px CSS width (AA 1.4.10 Reflow), except for content that requires 2D layout
      (data tables, maps, code) inside its own scroll container.
- [ ] Navigation collapses sensibly; menus are reachable on mobile.
- [ ] Touch targets >= 24x24px with spacing (AA 2.5.8); primary touch controls ~44x44px.
- [ ] Hover-only affordances have a non-hover equivalent (tap, focus, always-visible on touch).
- [ ] Fixed/sticky headers and footers do not cover focused elements (AA 2.4.11) or eat most of a small screen.
- [ ] Full-height layouts use `dvh`/`svh` units or flex, not `100vh`.
- [ ] Images are responsive (`max-width: 100%`, `srcset`/`sizes` where it matters) and have `width`/`height` to
      prevent layout shift.

## 7. Interaction states

- [ ] Hover, focus-visible, active, selected and disabled styles exist and are distinct from each other.
- [ ] Focus indicator is always visible for keyboard users (AA 2.4.7) and is not removed with `outline: none`.
- [ ] Loading: skeletons or spinners appear only after a short delay (~150-300ms) to avoid flicker; layout does
      not jump when data arrives.
- [ ] Empty state explains what goes here and offers the next action.
- [ ] Error state says what went wrong and how to fix it, preserves user input, and offers retry where relevant.
- [ ] Destructive actions require confirmation or offer undo.
- [ ] Buttons that trigger async work prevent double submission and show progress.
- [ ] Success feedback is visible (toast, inline message, state change) and announced (`aria-live`/`role="status"`).

## 8. Keyboard and screen readers

- [ ] Every interactive element is reachable via Tab in a logical (visual) order (AA 2.4.3); no positive tabindex.
- [ ] Enter/Space activate buttons; arrow keys work inside menus, tabs, radio groups, listboxes (per ARIA APG).
- [ ] Escape closes dialogs, popovers and menus; focus returns to the trigger.
- [ ] Modal dialogs trap focus and make the background inert (`<dialog>` + `showModal()`, or `inert` attribute).
- [ ] No keyboard trap anywhere (A 2.1.2).
- [ ] A "skip to main content" link exists on pages with large navigation (A 2.4.1).
- [ ] Every input has a programmatic label (A 1.3.1 / 4.1.2); required fields and errors are conveyed in text.
- [ ] Icon-only buttons have an accessible name; decorative icons have `aria-hidden="true"`.
- [ ] Images have appropriate `alt` (descriptive, or empty for decorative).
- [ ] ARIA is valid: roles have their required states (`aria-expanded`, `aria-selected`, `aria-controls`); no
      `aria-label` on elements that cannot be named (plain `div`/`span` without a role).
- [ ] Dynamic content updates (toasts, async results, validation) are announced via a live region.
- [ ] The page has a meaningful `<title>` and `lang` attribute; landmarks (`main`, `nav`) are present.

## 9. Motion

- [ ] Animations clarify a change in state or position; nothing loops or moves without reason.
- [ ] Durations 100-300ms for UI; only `transform`/`opacity` are animated.
- [ ] `prefers-reduced-motion: reduce` disables non-essential motion (parallax, slide-ins, auto-playing carousels).
- [ ] Nothing flashes more than three times per second (A 2.3.1).

## 10. Content

- [ ] Real, specific copy - no lorem ipsum, "Feature 1", or placeholder avatars left in.
- [ ] Buttons are labeled with verbs describing the outcome ("Save changes", "Delete project"), not "OK"/"Submit".
- [ ] Error messages are human, specific and blame-free.
- [ ] Dates, numbers and currencies are locale-formatted (`Intl.DateTimeFormat`, `Intl.NumberFormat`).
- [ ] Layout survives text expansion (German/Finnish strings ~30% longer) and RTL if the product is localized.

## 11. Performance of the UI

- [ ] No layout shift when fonts, images or data load (reserve space; `font-display: swap` with metric-matched
      fallbacks where possible).
- [ ] Long lists (hundreds+ rows) are virtualized or paginated.
- [ ] Heavy components/routes are lazy-loaded; images below the fold use `loading="lazy"`.
- [ ] Interactions respond within ~100ms (show pending state immediately even if work continues).

## Tools

- Contrast: browser DevTools color picker shows the ratio; or compute it from the WCAG relative-luminance formula.
- Automated scans: `npx @axe-core/cli <url>`, `npx lighthouse <url> --only-categories=accessibility`,
  `eslint-plugin-jsx-a11y` (React), `eslint-plugin-vuejs-accessibility` (Vue), Storybook a11y addon.
- Automated tools catch roughly a third of issues; the keyboard walkthrough and a screen-reader pass (VoiceOver,
  NVDA) catch the rest.
