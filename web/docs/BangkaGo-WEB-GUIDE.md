# BangkaGo-WEB — Project Guide

> **Read this before every prompt / build.** This is the source of truth for the website part. If a filename's purpose isn't clear, read the code first — don't guess, don't add/delete/rename files without asking.

---

## 1. Purpose

This guide prevents stray edits in `BangkaGO-WEB/`. Filenames are self-explanatory and describe their feature. Use this file to:
- understand what each file does,
- know what NOT to touch,
- craft prompts that keep builds consistent.

**How to use:** Before any task, read this guide + the specific file(s) you will touch. If unsure, open the file and read its CSS/JS links.

---

## 2. Scope Boundary

**In scope (website only):** `BangkaGo/BangkaGO-WEB/` — public site + two role dashboards.

**Out of scope:** capstone docs, data, mobile app, backend, other `docs/` files. Do NOT edit files outside `BangkaGO-WEB/` unless explicitly asked.

**Rule:** Do NOT add, delete, or rename files in `BangkaGO-WEB/` without user confirmation. Reuse existing files; prefer editing over creating.

---

## 3. Project Map (actual tree)

```
BangkaGo/
├── .vscode/
├── BangkaGO-WEB/
│   ├── index.html              # public landing (hero, stats, about, services, how-it-works, join, blog, contact, footer)
│   ├── style.css               # public theme (tokens, buttons, hero, cards, responsive)
│   ├── script.js               # public JS (nav scroll, active link, smooth scroll, search, forms, fade-in, back-to-top)
│   ├── bangkaGo-access.html    # portal chooser + login modal (demo auth, routes to dashboards)
│   ├── images/logo-BangkaGo.png
│   ├── images/map.jpg
│   ├── image/*                 # Hopping.jpg, View_beach.jpg, Marigondon-view.png, coast_guard.jpg
│   ├── admin-dashboard/
│   │   ├── admin-dashboard.html     # overview KPIs + operational snapshot
│   │   ├── manage-users.html        # user directory, status/role modals
│   │   ├── manage-bangkeros.html    # bangkero docs review + approve/reject
│   │   ├── manage-bangka.html       # vessel master list
│   │   ├── manage-routes.html       # routes CRUD
│   │   ├── manage-bookings.html     # bookings table, details/status/manifest/cancel
│   │   ├── manage-payments.html     # payments + report generation
│   │   ├── manage-alerts.html       # alert rules
│   │   ├── monitor-fleet.html       # live map + vessel history replay + ETA
│   │   ├── view-reports.html        # reports viewer
│   │   ├── view-manifest.html       # manifests viewer (admin)
│   │   ├── view-weather.html        # weather data + safety status
│   │   ├── analyze-demand.html      # demand trends
│   │   ├── report-compliance.html   # file compliance case with evidence
│   │   ├── partials/sidebar.html    # admin nav (Core Admin/Operations/Analytics/Environment)
│   │   ├── partials/topbar.html     # admin topbar (toggles + title/subtitle)
│   │   ├── assets/css/admin-theme.css
│   │   └── assets/js/admin-theme.js + layout-loader.js
│   └── coastguard-dashboard/
│       ├── index.html               # CG overview (weather, alerts, fleet, boats at sea)
│       ├── monitor-fleet.html       # live map + vessel location + ETA (read-only)
│       ├── view-manifests.html      # search manifest + passenger list + export
│       ├── view-weather.html        # marine weather view
│       ├── view-bangkeros.html      # bangkero list (read-only)
│       ├── alerts.html              # active alerts view
│       ├── reports.html             # operator records
│       ├── report-compliance.html   # submit compliance issue
│       ├── verify-departure.html    # check departure readiness
│       ├── search-vessel.html       # vessel lookup
│       ├── port-history.html        # port movements
│       ├── export-manifest.html     # export helper
│       ├── partials/sidebar.html    # CG nav (Core Monitoring/Compliance/Workflow)
│       ├── partials/topbar.html     # CG topbar (toggles + readonly pill)
│       ├── assets/css/coastguard-theme.css
│       └── assets/js/coastguard-theme.js + layout-loader.js
└── docs/
    └── BangkaGo-WEB-GUIDE.md   # this file
```

Demo credentials (in `bangkaGo-access.html:114`): `admin/admin123` → `admin-dashboard/admin-dashboard.html`, `coastguard/cg123` → `coastguard-dashboard/index.html`.

---

## 4. File Responsibility

| File | What it does | Do NOT |
|------|--------------|--------|
| `index.html` | Public landing, navbar `id="mainNav"`, sections `#home/#about/#services/#how/#join/#blog/#contact` | Rename section ids (breaks `script.js` active-link) |
| `style.css` | Tokens, `.btn-bgo` system, hero `background-attachment:scroll`, `fade-in`, `service-card`/`blog-card`, responsive `375/576/768/992` | Re-add `background-attachment:fixed`, add new `--blue-*` without syncing dashboard themes |
| `script.js` | `rafThrottle` nav scroll `handleNavScroll`/`highlightNavLink`, smooth anchor offset, `heroSearch` validation, `joinForm`/`contactForm` helpers, `IntersectionObserver 0.15`, back-to-top, year | Add unthrottled scroll listeners, query `div[id]` instead of `section[id]` |
| `bangkaGo-access.html` | Portal cards `.portal-card`, pills `.pill-admin/.pill-readonly`, modal `#loginModal` | Change grid to 1 col on desktop, remove `data-bs-toggle` |
| `admin-dashboard/*.html` | Each page is a feature; `data-page="..."` drives `layout-loader.js` title; table `id="*Body"` + modals | Create new pages instead of editing existing; break `id="sidebarMount"/"topbarMount"` |
| `coastguard-dashboard/*.html` | Read-only views; no status/role writes | Add write actions (violates read-only) |
| `*/partials/sidebar.html` | Nav links with `data-page="*.html"` + `id="cgSidebar"`/`id="cgNav"` | Change `id="cgSidebar"` (breaks `*-theme.js`) |
| `*/partials/topbar.html` | `id="topbarTitle"/"topbarSubtitle"` + toggles `id="sidebarMobileToggle"/"sidebarDesktopToggle"` | Remove toggles (breaks mobile <992px) |
| `*/assets/js/layout-loader.js` | Fetches `partials/sidebar.html` + `topbar.html`, sets title from `topbarMeta[currentFile]`, marks active link, calls `AdminTheme.init()` / `CoastguardTheme.init()` | Inline sidebar HTML, duplicate titles |
| `*/assets/js/*-theme.js` | Sidebar `collapsed`/`show` + `localStorage bangkago_*_sidebar_collapsed` + resize handler | Query `adminSidebar` only (must handle both `cgSidebar`/`adminSidebar` + `cgMain`/`adminMain`) |
| `*/assets/css/*-theme.css` | Tokens, `.btn` pill, `.cg-card`/`.kpi-card` `will-change/contain`, `.live-map-img aspect-ratio:16/9`, `.table-responsive thin scrollbar` | Reintroduce `height:320px` fixed map, `border-radius:6px` buttons, `width:380px` cols |

If a name is unclear: open it. Example — `manage-bangkeros.html` contains `bangkeros[]` + `#reviewDocsModal` + `#decisionModal`; `view-manifests.html` contains `manifests[]` + `passengerMap` + `exportMsg`.

---

## 5. Read-Before-Edit Protocol

1. Read this guide.
2. `read` the target file + its linked CSS (`<link rel="stylesheet" href="...">`) + JS (`<script src="...">`).
3. If behavior is unclear, `grep` for its `id`/`class`/`data-page` across `BangkaGO-WEB/`.
4. Propose changes — wait for confirmation if it adds/deletes/renames files.

---

## 6. Design Freeze (preserve unless asked)

- Tokens: `blue-900 #0a2540`, `blue-800 #0d3360`, `blue-700 #0e4d92`, `blue-600 #1565c0`, `accent #00b4d8`, `white #fff`, `gray-50 #f8fafc`, `gray-200 #e2e8f0`.
- Typography: `font-display Sora`, `font-body DM Sans` (`style.css:24`, `admin-theme.css:22`).
- Radius: `sm 8px`, `md 16px`, `lg 24px`, `pill 999px`; cards `16/18px`.
- Shadows: `sm 0 2px 8px`, `md 0 8px 32px`, `lg 0 20px 60px`.

---

## 7. Button / Motion / Responsive Rules

- **Buttons:** Use `.btn-bgo` base (`style.css:85`, `admin-theme.css:30`, `coastguard-theme.css:30`). Variants: `--primary` (blue), `--accent` (cyan), `--ghost` (outline blue), `--subtle` (gray). Sizes `--sm 36px`, default `38/44px`, `--lg 52px`. Legacy aliases kept: `.btn-primary-custom`, `.btn-service`, `.btn-bangkago` map to same. All have `border-radius:999px`, `focus-visible: 0 0 0 3px rgba(21,101,192,.18)`, `hover: translateY(-1px)`, `active:scale(.98)`. Action buttons: `.action-btn 96px/38px pill` with `flex-wrap gap .5rem` (`admin-theme.css:46`).
- **Motion:** `html scroll-behavior:smooth` + `prefers-reduced-motion` disables. Scroll handlers are `rafThrottle` (`script.js:11`). `fade-in` uses `IntersectionObserver threshold 0.15 rootMargin -40px` (`script.js:115`). No `background-attachment:fixed`.
- **Responsive:** Breakpoints `335/375/576/768/992/1200` (`style.css:1131`, `admin-theme.css:394`, `coastguard-theme.css:303`). Public hero search stacks to column at `<768px`. Maps use `aspect-ratio:16/9 max-height:420px`. Tables use `min-width` + `white-space:nowrap` + thin scrollbar, not `width:380px`.

---

## 8. Forbidden List

- Add/delete/rename files without asking.
- Introduce new dependencies (frameworks, CDNs beyond Bootstrap 5.3.3 + icons).
- Rename routes or `data-page` values that `layout-loader.js` relies on.
- Delete `partials/` or inline sidebar/topbar HTML.
- Add inline `<style>.action-btn{border-radius:6px}` or `border-radius:8/10px` buttons — use pill.
- Restore `background-attachment:fixed` or fixed `height:320/430px` maps.
- Hardcode `style="width:380px"` action cols or `width:300px` payments.
- Load `coastguard-theme.js` in `admin-dashboard/` (must be `admin-theme.js`) or wrong script order — correct is `bootstrap.bundle.min.js → *-theme.js → layout-loader.js`.

---

## 9. Prompt Template (copy-paste)

```
Per docs/BangkaGo-WEB-GUIDE.md, goal: [one sentence].
Scope: only edit [file(s)] in BangkaGO-WEB/.
Preserve: tokens/buttons/motion/responsive rules.
Do NOT: add/delete/rename files without asking.
Verify: [how to check — e.g., resize 375/768/992, no horizontal scroll].
If unclear, read the file first.
```

---

## 10. Verification

After a build, check: `git status` shows only intended edited files (plus this guide on first run), `docs/` exists alongside `BangkaGO-WEB/`, manual resize `320→1440` has no horizontal overflow, `grep -r "background-attachment:fixed" BangkaGO-WEB` returns nothing, `grep -r "width:380px" BangkaGO-WEB` returns nothing.

---

## 11. Changelog

- 2026-09-09: Created `docs/BangkaGo-WEB-GUIDE.md` during refinement: unified buttons to pill, smoother `rafThrottle` + `will-change`, full responsiveness `375/576/768/992`, fixed admin `topbar` toggles + script order, extracted portal `docs/` location per user request.
