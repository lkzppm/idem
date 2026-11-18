# Chrome — header, nav, section nav, language switch, footer

- [x] Tab change animation in the cartoon style that involves the IDEM mark in the header (the mark reacts when the active tab changes) — `components/site/tab-story.ts`, `nav-links.tsx`, `IdemMarkSplit`; filmed frame by frame in a harness (real module + `chrome.css`) on 2026-11-17
- [x] Language switch (pt / en) in the header, animated in the same style, keyboard and screen-reader friendly — `components/site/locale-switch.tsx` (radio group, one tab stop, arrows/Home/End, endonyms with `lang`)
- [x] Home: a glass section nav that appears once the hero scrolls away, tracks the section in view, jumps on click — `components/site/section-nav.tsx`, mounted by `app/layout.tsx` on `/`; contract `data-nav-section` + `id` + `data-nav-label`
- [x] Footer redesign in the project style, with the author's portfolio (https://lkzppm.vercel.app, added 2026-11-18), GitHub (https://github.com/lkzppm) and LinkedIn (https://www.linkedin.com/in/lucasppmc/) — hidden on `/sandbox`
- [x] Header, nav, switch and footer strings in both languages; metadata per locale — `lib/i18n/messages/chrome.ts`, `generateMetadata` in `app/layout.tsx`; placeholder CTAs too
- [x] Mobile (390 px): header, section nav and footer fit with no horizontal scroll — by layout budget: wordmark folds below 640 px, tabs pack to 8 px padding, section nav spans the width and scrolls sideways
- [x] Reduced motion honored everywhere in this area (story → underline cross-fade; drops jump; bar fades; footer hovers colour only)
- [x] Spec 04 (§5.1) and ADR-019 updated
- [x] Shared ink-drop selector (`components/site/goo.ts`) for the tab hover, language switch and section nav
- [x] Placeholder buttons moved off pills to `.btn` (no pill badges)

## Pending (dev server was down overnight; nothing could be checked in the running site)

- [ ] Look at the header in the running site, both themes, en and pt: underline position at rest, hover drop, language switch drop
- [ ] Click through Sandbox / Docs / Results / logo, and back/forward, and a link inside a page: story plays once per change, Data returns only after the page arrives
- [ ] Rapid clicks across tabs: the ball re-aims, nothing queues or jumps
- [ ] Switch language: labels re-measure, underline re-places, no console errors
- [ ] Home section nav once the landing marks its sections (`data-nav-section`): appears after the hero, tracks, jumps, hides near the hero; phone width scroll
- [ ] 390 px screenshots of `/` (en and pt) to confirm no horizontal scroll
- [ ] Footer in both themes; absent on `/sandbox`
- [ ] Reduced-motion pass in the running site
