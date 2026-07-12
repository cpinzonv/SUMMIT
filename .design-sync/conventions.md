# Summit design system — how to build with it

Summit is a student-workflow app. Its look is **frosted glassmorphism**: cool,
translucent "glass" surfaces over a soft gradient background, with a coral→teal
brand accent. Components are plain React — import a component and render it.

## Setup — no provider, but you must load the stylesheet

- **No context provider or theme wrapper is required.** Every component depends
  only on React; render it directly (e.g. `<Modal>`, `<Toggle>`).
- **Load `styles.css` once at the app root.** It carries the design tokens, the
  frosted-glass component classes, and (via a remote `@import`) the brand fonts
  **Plus Jakarta Sans** (body) and **Space Grotesk** (display). Without it,
  components render as unstyled boxes with system fonts.
- **Themes** are attribute-driven on `<html>`: `data-theme="dark"` switches to
  the dark glass palette; `data-compact="true"` tightens card padding. Set the
  attribute on the root element — no JS API.

## Styling idiom — Tailwind utilities + a few semantic classes

Summit is a **utility-class** system (Tailwind). Compose your own layout with
Tailwind utilities, and reach for these **semantic classes** for on-brand
surfaces and controls (all defined in `styles.css`):

| Class | Use |
|---|---|
| `glass-card` | primary frosted content card |
| `glass-panel` | lighter frosted panel (menus, toasts, inline groups) |
| `glass-modal` | dialog surface (what `Modal` uses internally) |
| `btn` + `btn-primary` | primary action — coral→purple gradient button |
| `btn` + `btn-soft` | secondary / cancel button |
| `btn` + `btn-danger` | destructive action (red) |
| `menu-item` | row inside a dropdown/kebab menu |
| `font-display` | Space Grotesk display face for headings |
| `animate-fade-up` | standard entrance animation |

Color + type tokens (use via Tailwind utilities or `var(--…)`):
`text-ink` (primary text), `text-muted` (secondary text), the `brand-400/500/600`
+ teal ramp for accents, and the gradient token `var(--grad-teal-purple)` for
accent fills (e.g. the on-state `Toggle`). Keep card glare **cool** — this is a
frosted, not warm, look.

## Where the truth lives

- **`styles.css`** and its `@import` closure — the authoritative tokens and
  component classes. Read it before inventing any class.
- Per component: **`<Name>.d.ts`** (the exact prop contract the agent codes
  against) and **`<Name>.prompt.md`** (usage notes). Prefer these over guessing
  props.

## One idiomatic snippet

```jsx
import { EmptyState, PriorityBadge, Toggle } from '@student-workflow/client';

function AssignmentsPanel({ notifications, onToggle }) {
  return (
    <div className="glass-card p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-lg font-bold text-ink">Assignments</h2>
        <PriorityBadge priority="high" />
      </div>
      <EmptyState title="No assignments yet">
        Add your first assignment and it&rsquo;ll show up here, sorted by due date.
      </EmptyState>
      <label className="mt-4 flex items-center gap-2 text-sm text-muted">
        Email reminders
        <Toggle on={notifications} onChange={onToggle} />
      </label>
    </div>
  );
}
```

Real Summit components carry the frosted look; the wrapping `glass-card`,
`font-display`, and `text-*` utilities are the agent's own on-brand layout glue.
