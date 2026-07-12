# design-sync notes — Summit design system

## What this syncs
The reusable primitives from the **Summit app** (`@student-workflow/client`, a
Vite React app — NOT a component library) into the Claude Design project
`Summit Design System`. Scope = the presentational primitives in
`client/src/components/ui.jsx` + `MountainMark`. App feature components
(modals-for-features, boards, route guards, tab views) are intentionally out of
scope.

## Off-envelope setup (important for re-sync)
This repo has **no library build and no TypeScript**, so the standard converter
path doesn't apply. The working configuration:

- **Curated entry**: `client/.design-sync-entry.jsx` re-exports exactly the
  scoped components. `cfg.entry` points at it. It lives **inside `client/`** on
  purpose — the converter walks up from the entry to the nearest named
  `package.json` to set `PKG_DIR`, and it must land on `client/` (so `src/` and
  the CSS snapshot resolve). Do not move it to repo root or `.design-sync/`.
- **`--node-modules node_modules`** (repo ROOT, not `client/node_modules`).
  React/react-dom are hoisted to the repo root; `client/node_modules` is empty.
  `nodePaths` resolves bare imports from there regardless of the entry location.
- **Component list** comes entirely from `cfg.componentSrcMap` (13 pins) because
  there are no `.d.ts` exports to discover. Prop contracts are hand-written in
  `cfg.dtsPropsFor` (JSX has no types). Update both when adding a component.
- **CSS is a committed snapshot**: `client/.design-sync-styles.css` is a copy of
  the compiled Tailwind stylesheet (`client/dist/assets/index-*.css`). The raw
  `client/src/index.css` is NOT usable (unexpanded `@tailwind`/`@layer`).
- Build/validate/capture all run from the repo root with
  `--node-modules node_modules --out ./ds-bundle`.

## Fonts
- Brand fonts **Plus Jakarta Sans** + **Space Grotesk** load via a remote Google
  Fonts `@import` at the top of the stylesheet → `[FONT_REMOTE]` (expected, no
  action). They are NOT shipped locally.
- The compiled app CSS also carries KaTeX `@font-face` rules whose files aren't
  in the bundle → `[FONT_DANGLING]` on katex_*. **Benign** — KaTeX is unrelated
  to these components; the rules are auto-dropped from `_ds_bundle.css`.

## Known render warns (benign — do not chase on re-sync)
- **MountainMark `[RENDER_THIN]`**: it's a pure SVG logomark with no text, so the
  "mounts have no text" heuristic fires. It renders correctly (all 3 variants,
  ~13KB PNG). Benign.

## Fixed-position preview gotchas (already solved in previews/)
Several components use `position: fixed`, which escapes the preview card capture.
The fix (pure composition, component unchanged) is a wrapper with a `transform`
(a containing block for the fixed child):
- **Modal / ConfirmModal** (`fixed inset-0`): wrapped in a sized
  `transform` Frame + `cardMode: single` + a `viewport` tall enough for the
  dialog, else the title clips above the card.
- **Toast** (`fixed bottom-6`): wrapped in a small `transform` Frame +
  `cardMode: single`, `primaryStory: Success`.
- **Toast error variant dropped on purpose**: an error toast (`type:'error'`)
  renders fine but the capture harness scrapes its "⚠ Could not save changes"
  text and misreads the error toast as a preview *error* (false positive). Only
  `Success` + `Loading` are kept; the `type` prop stays documented in the .d.ts.

## KebabMenu
Its dropdown only opens on click (state-driven) and can't render statically. The
preview shows the closed ⋮ trigger inside a realistic card row.

## Re-sync risks (watch-list for the next run)
- **CSS snapshot staleness**: `client/.design-sync-styles.css` is a point-in-time
  copy. After any app restyle, rebuild the client (`cfg.buildCmd`) and refresh
  the snapshot from the new `client/dist/assets/index-*.css` (the dist filename is
  content-hashed and gitignored, so it can't be referenced directly).
- **New primitives** added to `ui.jsx` will NOT appear automatically — add them to
  `client/.design-sync-entry.jsx`, `cfg.componentSrcMap`, and `cfg.dtsPropsFor`.
- **dtsPropsFor drift**: prop contracts are hand-written; if a component's props
  change in source, update the matching `dtsPropsFor` entry (nothing enforces it).
- Playwright/Chromium is required for render-check + capture (installed to the
  ms-playwright cache this run).
