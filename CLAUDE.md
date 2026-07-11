# CLAUDE.md

Guidance for Claude Code (and any AI agent) working in this repository.

## Brand

Summit's visual and verbal identity is locked. The full specification lives at
**docs/brand/summit-brand-kit.html** (open it in a browser) with the logomark at
**docs/brand/summit-logo.svg**. Any UI, social, marketing, or design asset generated
from this repo must follow it. Summary:

### Colors
- Coral #ff7a52 (logo gradient start) · Sunset #ff6f73 · Logo Teal #3fb8c0
- Hero Orange #ff8a4c · Sky #4f9fd6
- Brand teal scale: 50 #eaf6f6 · 100 #cdebec · 400 #3fb1b8 · 500 #2f9fa8 · 600 #2a868f (links/actions) · 700 #246e76
- Cream #f1e9e1 (page canvas — never plain white) · Ink #1f2933 (text)

### Gradients
- Hero (headlines, wordmark, hero CTAs): linear-gradient(135deg, #ff8a4c 0%, #ff6f73 45%, #4f9fd6 100%)
- Logo stroke only: #ff7a52 → #ff6f73 (50%) → #3fb8c0
- Warm accent: linear-gradient(135deg, #ff7e79 0%, #ffc59e 100%)
- Page background: cream + four corner radial glows (exact recipe in the brand kit)

### Typography
- Display: Space Grotesk 700, letter-spacing -0.025em
- Body/UI: Plus Jakarta Sans 400–600
- Gradient text (hero gradient + background-clip) is for the wordmark and one hero line per screen only

### Logo
- The mark is ONE smooth continuous gradient stroke (see MountainMark.jsx / summit-logo.svg). Never redraw, fill, rotate, or alter its gradient stops. White-stroke variant on gradient/photo backgrounds only.
- Wordmark: "Summit" sentence case, Space Grotesk 700, hero-gradient fill.

### Components
- Glass cards: white gradient at partial opacity, blur(18px), 1px near-white border, 24px radius, soft warm shadow
- Radii: 24px cards / 16px tiles / 12px inputs · borders always 1px
- No emojis in product UI. EXCEPTION — email templates: table layout + inline styles only, no glassmorphism, no backdrop-filter, no flexbox.

### Voice
- Calm, concrete, benefit-first. Peer-to-peer: a student talking to students.
- Never: exclamation points in product/paywall copy, guilt-trip dismissals, fake urgency, dark patterns, corporate buzzwords.
- Never reference unshipped features in copy or gating logic (nothing ships in copy before it ships in code).
- Locked lines — Tagline: "Your whole semester, handled." · Founder: "Built by a college student, for college students." · Fairness: semester pricing is one payment, no auto-renewal.
