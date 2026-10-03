# Production Readiness Report — Nahda Web Frontend

---

# 1. Executive Summary

```text
Project:                nahda-web (Vanilla JS SPA, Vite 5) — case management for مؤسسة نهضة بني سويف
Audit Date:             2026-09-30
Audited Scope:          Working tree of D:\nahda app\nahda-webb-main (HEAD 204f164 + 50 modified + 13 untracked files)
                        src/ (JS, HTML templates, CSS), public/, index.html, package.json / lock,
                        vite / eslint config, Dockerfile, nginx.conf, vercel.json, netlify.toml, public/_headers, .env*
Frontend Only:          YES — backend not inspected; API contract docs referenced in code
                        (WEB_API_DOCUMENTATION.md, FRONTEND_REPORTING_HANDOFF.md) are NOT in this repo
Overall Status:         NOT PRODUCTION READY
Production Readiness:   55%
Critical Blockers:      3
High Priority Issues:   8
Medium Priority Issues: 15
Low Priority Issues:    14
```

**What was actually executed**

| Check | Command | Result |
|---|---|---|
| Production build | `vite build` (output to a temp dir; `dist/` was not touched) | ✅ Success: 476 modules, 5.6 s. ⚠️ 2 chunks over 500 kB |
| Lint | `eslint .` | ✅ 0 errors, 8 warnings (unused vars / useless assignments) |
| Dependency audit | `npm audit` | ⚠️ 1 high + 1 moderate, **both in `vite`/`esbuild` (dev server only)** |
| Outdated | `npm outdated` | `vite` 5.4.21 → latest 8.3.1 (major) |
| Tests | — | ❌ No test framework, no tests, no test script |
| Visual / responsive testing | — | ❌ **Not performed.** Responsive findings come from CSS static analysis only |
| Backend contract | — | ❌ Not verified. Findings describe what the frontend *expects* |

**Bottom line:** the app builds, and the core infrastructure is solid: HTTP client, error types, session teardown, CSP/security headers, and dialog accessibility. But the main business flow, create/edit case, has **two silent data-loss paths**. The audited code is also **not committed**, so a deploy from git would ship different code.

---

# 2. Project Overview

| Aspect | Finding |
|---|---|
| Framework | None. Vanilla ES modules, no TypeScript (one `.ts` file used only for JSDoc types: `src/types/reports.types.ts`) |
| Build tool | Vite 5.4.21 (`vite.config.js`: dev proxy `/api` → backend) |
| Runtime dependencies | `jspdf@4.2.1` only. `html2canvas` is imported directly but is only an *optional* transitive dependency of jspdf (see M-12) |
| Language / direction | Arabic, RTL (`<html lang="ar" dir="rtl">`) |
| Rendering model | 12 HTML templates imported with `?raw` and all mounted at boot (`src/core/loader.js`). Views are shown and hidden with the `page-view--hidden` class |
| Routing | Custom `switchView()` (`src/core/router.js`). **No URL routing**: the current view is stored in `localStorage` (`nahda_current_view`) |
| API layer | `src/services/http.js`: one `request()` that adds the Bearer token, unwraps the `{success,data\|error}` envelope, handles timeouts, and does a single serialized refresh + retry on 401 |
| Authentication | Email/password → access token (15 min) + rotating refresh token, both in `localStorage` (`src/services/tokens.js`) |
| Authorization | `src/core/permissions.js`: server `permissions[]` from `/auth/me`, with a static role matrix as fallback. Roles: `manager`, `reviewer`, `data_entry` (`social_worker` is blocked on web) |
| State | `src/state/store.js` singleton plus `EventBus` pub/sub. Components also keep module-level closure state |
| Deployment targets | Docker (nginx-unprivileged + envsubst template), Vercel, Netlify. All proxy `/api/*` to `https://srv1990155.hstgr.cloud` because the backend sends no CORS headers |

---

# 3. Architecture Assessment

### Current Architecture
```text
index.html → main.js → core/app.js (bootstrap)
  ├─ core/loader.js        mounts 12 views + 8 wizard steps (all eager)
  ├─ core/router.js        switchView(), boot guard (/auth/me), logout
  ├─ core/session.js       clearSessionData() / endSession() → full reload
  ├─ core/permissions.js   can(), canAccessView(), opinion-slot rules
  ├─ services/*            http.js + 12 domain services (~75 endpoints)
  ├─ state/store.js        global store (+ EventBus events)
  ├─ components/*          24 component modules (DOM + business logic + API calls)
  └─ utils/*               dom, toast, dialog, a11y, error-state, nationalId, dates
```

### Strengths
- **Single HTTP chokepoint** with a per-request timeout (`http.js:98-137`), refresh serialized across concurrent callers (`http.js:139-159`), no retry on 403, and typed errors (`ApiError`, `NetworkError`, `RequestTimeoutError`).
- **Bootstrap isolation**: each initializer runs in `runInit()`, so one failing component doesn't kill the app (`app.js:54-68`). The user is warned with a toast (`app.js:133-135`).
- **Session teardown** wipes tokens, store, caches, and sessionStorage dropdown caches, then does a full reload (`session.js:27-51`). This prevents cross-account data leaks between users.
- **Security headers and CSP** are defined consistently in all three deploy targets (`nginx.conf:52-59`, `vercel.json`, `public/_headers`).
- **Reusable a11y infrastructure**: global dialog manager with focus trap, `inert`, Escape, and focus restore (`utils/a11y.js`). Promise-based `confirmDialog`/`promptDialog` replace `window.confirm` (`utils/dialog.js`).

### Weaknesses
- **Giant multi-responsibility modules** that mix DOM rendering, business rules and API calls: `case-details.component.js` (1,783 lines), `workflow.component.js` (1,258), `case-pdf.service.js` (1,189), `employees.component.js` (1,062), `dashboard.component.js` (1,049).
- **Global coupling** through `window.switchView` (`router.js:308`) and `window.openCaseDetailsPage` (`case-details.component.js:28`).
- **All views load and initialize at boot**, including all data-loading initializers for a signed-in user (`app.js:98-129`).
- **No URL routing**: no deep links, and the browser Back button leaves the app (see M-05).
- **Dead or legacy layers**: `src/modules/*` (9 re-export shims, none imported), `state/selectors.js`, `state/signals.js`, and unused store actions for charities/employees.

### Risks
- Business-critical save logic (`personal-data.api.js`, 871 lines) has zero test coverage and contains the data-loss paths BLOCKER-001 and BLOCKER-002.
- JS without types, plus server response shapes consumed without validation, means backend contract drift fails at runtime.

### Recommendations
- Extract the case-wizard save pipeline into a tested module (pure payload builders + an orchestrator).
- Introduce hash-based routing (`#/cases/:id`) on top of the existing `switchView()`.
- Delete the dead shims. Split `case-details.component.js` into renderers, actions and timeline modules.

**Verdict:** Maintainable by the current team with effort. Scalable: *limited*. Production-suitable: *yes, once the blockers are fixed*.

---

# 4. Feature / Route Inventory

There are no URL routes. Each "route" below is a `switchView()` view key. Every view except `login` requires a session (`router.js:345-348`). Gating is client-side only (`permissions.js:121-132`); the backend is expected to enforce every permission.

| Feature | View key | Implemented | API Connected | Error Handling | Loading | Empty State | Status |
|---|---|:-:|:-:|:-:|:-:|:-:|---|
| Login | `login` | ✅ | ✅ `/auth/login` | ✅ code→Arabic message map | ✅ button spinner + disabled | n/a | OK |
| Dashboard (KPIs, work queue, search) | `dashboard` | ✅ | ✅ | ✅ error state + retry | ⚠️ fake numbers shown while loading (M-04) | ✅ | Needs fix |
| Case wizard (8 steps, create/edit) | `personal-data` | ✅ | ✅ ~15 endpoints | ❌ silent failures (H-04), data loss (BLK-001/002) | ✅ Next button disabled during save | n/a | **Blocked** |
| All cases list | `all-cases` | ✅ | ✅ `/search/cases`, `/cases` | ✅ error state + retry | ✅ + "load more" | ✅ | OK |
| Case details / review / approve | `case-details` | ✅ | ✅ | ⚠️ partial failures shown as empty (H-05) | ❌ no indicator while opening | ⚠️ | Needs fix |
| Case timeline | modal in case-details | ✅ | ✅ `/cases/{id}/timeline` | ✅ toast | ✅ | ✅ | OK |
| PDF export (case, roster) | case-details, case-support-filter | ✅ | client-side | ✅ toast | ✅ button disabled | n/a | OK (raster output, L-07) |
| Charities CRUD | `charities` | ✅ | ✅ | ✅ error state + retry | ✅ | ✅ | ⚠️ capped at 100 (H-07) |
| Locations + dropdown config admin | `state-mgmt` | ✅ | ✅ | ⚠️ toast only | ⚠️ | ⚠️ | OK |
| Employees CRUD / roles / reset PW | `employees` | ✅ | ✅ | ✅ error state + retry | ✅ | ✅ | ⚠️ capped at 100 (H-07) |
| Profile + avatar | `profile` | ✅ | ✅ | ✅ 409 handled | ✅ | n/a | OK (M-07) |
| Reports (9 dashboards, comparison, builder, CSV) | `reports` | ✅ | ✅ ~25 endpoints | ❌ dashboards fail silently (M-03) | ⚠️ | ✅ builder | Needs fix |
| Case/charity/support filter (manager) | `case-support-filter` | ✅ | ✅ | ✅ | ✅ | ✅ | OK |
| Background studio | `bg-studio` | ✅ | local only | n/a | n/a | n/a | OK (cosmetic feature) |
| Notifications bell | header | ❌ | ❌ | — | — | — | **Dead UI** (L-02) |

### Route-behaviour matrix

| Scenario | Behaviour observed in code | Status |
|---|---|---|
| Unauthenticated user | No refresh token → `clearSessionData()` + login view (`router.js:345-348`); data initializers skipped (`app.js:91-92`) | ✅ |
| Authenticated user, refresh | Saved view reopens; `/auth/me` re-verifies in the background (`router.js:349-410`) | ✅ |
| Wrong role (web UI) | `canAccessView()` → toast + redirect to dashboard (`router.js:20-23`). Sidebar hides entries (`sidebar.component.js:145-161`) | ✅ UX gate only; sidebar inconsistent (M-06) |
| Role not allowed on web (e.g. `social_worker`) | `/auth/me` → `performLogout()` with explanation (`router.js:359-363`) | ✅ |
| Expired session | 401 → one refresh → retry; refresh failure → `SESSION_EXPIRED` → reload to login with toast (`http.js:196-211`, `router.js:295-301`) | ⚠️ also triggers on network errors (H-01) |
| Logged-out user | Server revoke, then full wipe + reload (`router.js:272-285`) | ✅ |
| Direct URL / deep link | Impossible: every URL is `/`. Other paths return 404 (`nginx.conf:108-110`) | ❌ (M-05) |
| Back / Forward buttons | Leave the app entirely (no `history.pushState`) | ❌ (M-05) |
| Unknown view key | Falls into the `else` branch → dashboard (`router.js:252-262`) | ✅ |
| Refresh on case-details | Re-fetches `LAST_VIEWED_CASE_ID` (`case-details.component.js:39-48`) | ✅ |
| Refresh on case wizard | Step number is restored but the case context is lost; unsaved input is lost (H-03) | ❌ |

---

# 5. API Audit

All calls go through `HttpClient` (`http.js`) except: CSV report export (`reports.service.js:226`) and presigned storage PUTs (`attachments.service.js:90`, `profile.service.js:75`).
Common behaviour: Bearer auth, 30 s timeout (`config/env.js:25`), 401→refresh→retry, envelope unwrapping, typed errors.

| Endpoint group | Methods | Used by | Auth | Error Handling | Loading | Validation (client) | Status |
|---|---|---|---|---|---|---|---|
| `/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/me` | POST/GET | login, router, http | `X-Client-Type: web`; refresh excluded from retry | ✅ | ✅ | email/password required | ⚠️ H-01, H-02 |
| `/cases` (list, create), `/cases/{id}`, `/report`, `/timeline`, `/completion`, `/family-members`, `/support` | GET/POST | wizard, details, lists | Bearer | ⚠️ secondary reads swallowed as empty (H-05, BLK-001) | ⚠️ | national ID checksum (`utils/nationalId.js`) | ❌ |
| `/cases/{id}/{beneficiary,family-members,housing,utilities,agriculture,initial-needs,classification,assessed-needs,financial,support-recommendations,approved-support}` | PUT | wizard | Bearer + rowVersion | ⚠️ 409 handling defeated (BLK-002); unhandled rejection (H-04) | ✅ | per-step validators | ❌ |
| `/cases/{id}/{assign,opinions/reviewer,return-to-worker,opinions/manager,return-for-completion}` | POST | case-details, wizard | Bearer + `Idempotency-Key` | ✅ 409 → refetch (`case-details.component.js:1262-1266`) | ✅ button disabled | required decision/notes | ✅ |
| `/cases/{id}/opinions/social-worker-assessment` | PUT | wizard step 8 | Bearer | ⚠️ H-04 | ✅ | brief required if detailed | ⚠️ |
| `/search/cases` | GET | dashboard, all-cases, filter, duplicate check | Bearer | ✅ | ✅ | ≥2 chars (server 422) | ✅ |
| `/attachments/init`, PUT presigned URL, `/{id}/commit`, `/{id}/download`, DELETE `/{id}`, `/cases/{id}/attachments` | POST/PUT/GET/DELETE | wizard step 2, details | Bearer (not on PUT) | ✅ | ⚠️ stage only, no %, no timeout (M-07) | MIME allowlist + 10 MB | ⚠️ |
| `/profile`, `/profile/avatar/{init,confirm}`, DELETE `/profile/avatar` | GET/PUT/POST/DELETE | profile | Bearer | ✅ | ✅ | MIME + 5 MB | ⚠️ M-07 |
| `/charities` (CRUD, export) | GET/POST/PUT/DELETE | charities, dashboard, cascades, filter | Bearer | ✅ | ✅ | name/center/village required | ⚠️ H-07 |
| `/employees` (CRUD, export, social-workers, role, activate, deactivate, reset-password) | GET/POST/PUT/DELETE | employees, wizard assign modal | Bearer | ✅ | ✅ | required fields | ⚠️ H-07, M-08 |
| `/locations`, `/centers`, `/villages`, `/reset` | GET/POST/PUT/DELETE | state-mgmt, cascades | Bearer | ⚠️ toast only | ⚠️ | name required | ⚠️ |
| `/dropdowns`, `/dropdowns/{key}`, `/dropdown-configs*`, `/dropdown-options/{id}` | GET/POST/PATCH | wizard selects, state-mgmt | Bearer | ✅ (sessionStorage cache, cleared on logout) | n/a | ✅ | ✅ |
| `/dashboard/stats`, `/dashboard/work-queue` | GET | dashboard | Bearer | ✅ retry | ⚠️ M-04 | n/a | ⚠️ |
| `/reports/*` (catalog, datasets, 9 dashboards, 11 fixed reports, comparisons, builder/run) | GET/POST | reports | Bearer | ❌ dashboards: console only (M-03) | ⚠️ | builder filters | ⚠️ |
| `/reports/export` (CSV) | POST (raw `fetch`) | reports builder | Bearer, **no refresh** | ⚠️ plain `Error` (M-13) | ✅ | — | ⚠️ |

**Environment / URL checks**

| Check | Result |
|---|---|
| `localhost`, `127.0.0.1`, `0.0.0.0`, private IPs in `src/` | Not observed |
| HTTP (non-TLS) URLs | Not observed in `src/`. Backend upstream is HTTPS with `proxy_ssl_verify on` (`nginx.conf:72-76`) |
| API base URL | `VITE_API_BASE_URL=/api/v1` (relative, same-origin), fallback `/api/v1` (`config/env.js:16`) |
| Backend host | `srv1990155.hstgr.cloud` hard-coded in 5 files (`vite.config.js:1`, `Dockerfile:37`, `vercel.json:9`, `netlify.toml:16`, `README.md`) (L-08) |
| API versioning | `/api/v1` ✅ |
| Timeout | ✅ 30 s default, 120 s for CSV export (`config/env.js:25-27`) |
| Retry | Only 401→refresh→retry once. Manual "retry" buttons on 4 list screens. No automatic retry on 5xx/network (acceptable) |
| Request cancellation / race protection | Sequence tokens on search/filter (`workflow.component.js:1059`, `case-support-filter.component.js:421`). In-flight dedupe for charities (`charities.service.js`) |
| Pagination | Cases: 50 per page + "load more" ✅. Charities/employees: fixed `limit: 100`, **no paging** (H-07) |

---

# 6. Authentication & Authorization

| Area | Finding | Evidence |
|---|---|---|
| Login | ✅ Error-code→message map, button loading state, reload into a clean signed-in boot | `login.component.js:50-130` |
| Logout | ✅ Server revoke (best effort) → wipe → reload | `router.js:272-285`, `session.js:40-51` |
| Session persistence | Refresh token presence = session (`tokens.js:29-31`). Stored user is verified with `/auth/me` on every boot | `router.js:349-410` |
| Token storage | ⚠️ Access **and refresh** tokens in `localStorage` (H-06) | `storage.js:21-23`, `tokens.js:37-41` |
| Expiration | Reactive only (401-driven). `isAccessTokenExpiring()` exists but is never called (L-10) | `tokens.js:23-27` |
| Refresh | ✅ Serialized within a tab. ❌ Not across tabs (H-02). ❌ Network failure during refresh = forced logout (H-01) | `http.js:139-159, 196-201` |
| 401 | ✅ One refresh + retry; a second 401 → force logout | `http.js:196-211` |
| 403 | ✅ Never retried. Mapped to a "no permission" message and a non-retryable error state | `errors.js:50`, `error-state.js:44-51` |
| Multiple tabs | ❌ No `storage`-event sync. Logout in tab A isn't reflected in tab B until its next 401 (H-02) | grep: no `storage` listener, no `BroadcastChannel` |
| Logout cleanup | ✅ Complete (tokens, user, stage, lists, caches, sessionStorage caches, last case) | `store.js:166-195`, `session.js:27-34` |
| Roles | `manager`, `reviewer`, `data_entry`. `social_worker` blocked on web | `permissions.js:16-30`, `router.js:359` |
| Guards | `canAccessView()` in `switchView()` + sidebar visibility | `router.js:20`, `sidebar.component.js:145-161` |
| Security boundary | Frontend gating is UX only. `can()` also **grants** extra permissions client-side beyond the server list (`permissions.js:171-181`). Backend enforcement assumed, **not verified** | M-06 |

---

# 7. Security Findings

| ID | Severity | Finding | File | Line | Impact | Recommendation |
|---|---|---|---|---:|---|---|
| SEC-01 | High | Refresh + access tokens stored in `localStorage` | `src/services/tokens.js` / `storage.js` | 37-41 / 21-23 | Any XSS (including via a compromised dependency) can exfiltrate a long-lived refresh token → persistent account takeover | Backend dependency: move the refresh token to an `HttpOnly; Secure; SameSite=Strict` cookie and keep the access token in memory only |
| SEC-02 | Medium | Server strings interpolated into `innerHTML` without escaping: `c.nid` (nationalId), `c.id` (displayId/caseNumber), `c.statusLabel`, `c.rawId` | `src/components/all-cases/all-cases.component.js` | 282, 285, 292, 308 | Stored XSS if the backend (or the mobile app) accepts non-numeric national IDs. Mitigated by the CSP `script-src 'self'` **only when deployed with the provided configs** | Wrap in `DOM.escapeHTML()` |
| SEC-03 | Low | Report dataset/dimension/metric names from `/reports/datasets` put in `innerHTML` unescaped | `src/components/reports/reports-builder.component.js` | 156, 173, 181, 441-442 | Server-controlled enum values; low exploitability | Escape anyway |
| SEC-04 | Low | User name via `innerHTML` in fallback branches (only when `.dash-hero-card__greeting` is missing, which it currently isn't) | `dashboard.component.js` / `login.component.js` | 43 / 146 | Latent XSS if the template changes | Use `textContent` |
| SEC-05 | Medium | Generated employee passwords shown in plaintext and sent via WhatsApp deep link / clipboard | `src/components/employees/employees.component.js` | 396-406, 474-493 | Credentials persist in WhatsApp/chat history and clipboard managers | Enforce password change at first login (backend). Prefer a one-time activation link |
| SEC-06 | Medium | `vite@5.4.21` advisories: GHSA-fx2h-pf6j-xcff (high, `server.fs.deny` bypass on Windows), GHSA-4w7w-66w2-5vf9, GHSA-v6wh-96g9-6wx3; esbuild GHSA-67mh-4wv8-2f99 | `package.json` | 16 | **Dev server only**, not in the production bundle. Risk to developer machines running `npm run dev` | Upgrade vite (major; fix available in 8.3.1) or never expose the dev server (`--host`) |
| SEC-07 | Low | Third-party hotlinked default avatar (images.unsplash.com) | `sidebar.component.js`, `profile.component.js`, `dashboard.component.js`, `dash-hero.html` | 135, 19, 50, 5 | Every page load leaks user IP/UA to a third party. Requires `img-src https:` in the CSP | Ship a local default avatar |
| SEC-08 | Info | CSP `connect-src 'self' https:` and `img-src https:` are broad (documented as needed for presigned storage URLs) | `nginx.conf` | 57 | Weaker exfiltration protection | Pin the object-storage origin once known |
| SEC-09 | Info | No secrets, API keys, private keys, Firebase config or credentials found in `src/`, `.env`, `.env.example`, or build output | — | — | — | Keep `.env` out of git (already in `.gitignore`) |
| SEC-10 | Info | Security headers present: CSP, XFO DENY, nosniff, Referrer-Policy, Permissions-Policy, HSTS | `nginx.conf` / `vercel.json` / `public/_headers` | 56-62 | ✅ | TLS termination is outside the container (listens on :8080). Confirm HTTPS at the edge |

---

# 8. Error Handling

| Case | Handling | Evidence | Gaps |
|---|---|---|---|
| 400 | Envelope message or generic fallback | `http.js:86-87`, `errors.js:78-86` | — |
| 401 | Refresh + retry once → forced logout with an explanation | `http.js:196-211` | Network failure during refresh also logs out (H-01) |
| 403 | Friendly message, non-retryable error state | `errors.js:50`, `error-state.js:44-51` | — |
| 404 | `CASE_NOT_FOUND` mapped; generic `NOT_FOUND` falls back to the server message | `errors.js:64` | — |
| 409 | `CONCURRENCY_CONFLICT` → refetch versions | `case-details.component.js:1264`, `personal-data.api.js:83-85` | Pre-write refetch defeats it for list sections (BLK-002) |
| 422 | Field-level highlighting on Step 1. Elsewhere, message toast | `personal-data.api.js:87-89` | Other steps don't map `details` to fields |
| 429 | `RATE_LIMITED` message + retryable state | `errors.js:53`, `error-state.js:52-58` | — |
| 500/502/503/504 | Non-JSON gateway page → "unexpected response" ApiError; ≥500 → "temporary server problem" state | `http.js:77-80`, `error-state.js:59-66` | — |
| Network / offline | `NetworkError` with Arabic message and retry | `http.js:129-132`, `error-state.js:36-42` | No `online`/`offline` listeners (not required) |
| Timeout | `RequestTimeoutError` after 30 s | `http.js:107-112` | Presigned uploads have **no timeout** (M-07) |
| Malformed / unexpected | Non-JSON → ApiError. Missing `success:true` → ApiError | `http.js:74-87` | Empty 2xx body (e.g. `204`) is treated as an error (L-09, not verified) |
| Unknown | Generic Arabic message; raw stack traces never shown | `errors.js:85` | No global `unhandledrejection` handler (H-04, M-09) |
| Raw `[object Object]` / `undefined` shown to users | Not observed. PDF uses `val()` fallbacks (`case-pdf.service.js:20-25`) | — | — |

**Silent-failure hotspots (the user sees nothing, or sees wrong data):**
- `reports.component.js:268, 334, 372, 419, 439, 457, 482, 530, 577`: every reports dashboard logs to the console only (M-03).
- `case-details.component.js:438-440` and `case-edit.loader.js:355-357`: failed secondary reads become empty data (H-05, BLK-001).
- `personal-data.api.js:568, 743, 793, 836`: rejection escapes `runSave()` → no toast (H-04).
- `workflow.component.js:819`: failed `/locations` load logs a warning only; Step 1 then can't resolve center/village IDs.

---

# 9. UX/UI Readiness

| State | Assessment |
|---|---|
| Loading | ✅ Lists (cases, charities, employees), login button, wizard Next button, PDF export button. ❌ Opening case details has no indicator and double-clicks trigger duplicate loads (`all-cases.component.js:331-335`). ❌ Dashboard KPIs show hardcoded numbers **24 / 1,450 / 38 / 156** until stats arrive (`dash-kpis.html:46, 64, 81, 97`) |
| Empty | ✅ Cases, search, filter, charities, employees, report builder, specialist search |
| Error | ✅ Error state + retry on 4 list screens (`utils/error-state.js`). ❌ Reports dashboards silent. ❌ ~60 error/warning toasts render with the **green success icon**, because `showToast` defaults to `'success'` (`utils/toast.js:377`), e.g. `router.js:21`, `case-support-filter.component.js:344, 424` |
| Success | ✅ Toasts, credentials modal, case number announcement |
| Disabled | ✅ Submit buttons during requests. Assign button disabled by case status |
| Validation | ✅ Per-step validators with warn-then-allow, national ID checksum, final "incomplete steps" gate (`workflow.component.js:776-797`) |
| Destructive actions | ✅ `confirmDialog({danger:true})` replaces `window.confirm` (no native `alert/confirm/prompt` remains) |
| Unsaved changes | ❌ No guard. Refresh, logout, or session expiry drops wizard input (H-03) |
| Dead UI | ❌ Notifications bell has no handler (`header.html:11`) |
| Responsiveness | ❌ See §10/M-10: no phone layout for the shell |

---

# 10. Accessibility

Static review only. No screen-reader or axe run was performed.

| Finding | Evidence | Severity |
|---|---|---|
| ✅ Global modal manager: role/aria-modal/label, focus trap, `inert` background, Escape, focus restore | `utils/a11y.js` | — |
| ✅ Toast is a live region (`role=status`, `aria-live=polite`) | `utils/toast.js:381` | — |
| ✅ Load errors use `role="alert"` | `utils/error-state.js:87` | — |
| ✅ All icon-only buttons have `aria-label`/`title` (0 unnamed buttons across 20 templates) | template scan | — |
| ✅ `prefers-reduced-motion` respected | `layout.css:522` | — |
| ❌ 19 "other" free-text inputs have no label (placeholder only) | `step3-housing.html:39-115`, `step4-utilities.html:29-177`, `step5-agriculture.html:104` | Low |
| ❌ Sidebar profile footer is a clickable `<div data-view-target>` with no role or tabindex → not keyboard reachable | `sidebar.html:151` | Low |
| ❌ Error toasts announced with success semantics/icon (see §9) | `utils/toast.js:377` | Medium |
| ⚠️ Status conveyed by color in badges/pills (text also present) | `case-details.component.js:978` | Info |
| ⚠️ Color contrast on glassmorphism backgrounds with user-chosen blur/brightness (`bg-studio`) | Not verified | — |

---

# 11. Performance

| Area | Finding |
|---|---|
| Bundle | `index-*.js` **539.7 kB (132 kB gzip)**: all 12 views + templates in one chunk. `case-pdf.service-*.js` **628.6 kB (185 kB gzip)** lazy-loaded ✅. `index.es-*.js` 151 kB, `purify.es` 29 kB (lazy, from jspdf). CSS 132.7 kB (22 kB gzip) |
| Code splitting | Only the PDF service is split (`case-details.component.js:140`, `case-support-filter.component.js:510`). Reports (718 + 498 lines + 941 CSS lines) load for every role |
| Boot | A signed-in boot fires ~18 dropdown requests (awaited) and then ~10 initializers with their own requests (`app.js:98-125`), including screens the user may never open |
| Assets | 10 images in `public/assets` (≈470 kB total). `background.jpg` and `pageground.jpg` are **byte-identical** (same MD5). Unused `src/assets/fonts/Cairo-*.ttf` (≈79 kB, never referenced). Google Fonts loads 3 families / 11 weights |
| Caching | nginx: hashed bundles immutable 1y, `index.html` no-cache, API no-store ✅. Reports: 45 s in-memory cache (`reports.service.js:12`). Dropdowns: sessionStorage |
| Lists | Cases paginate at 50 with append-only rendering (`all-cases.component.js:339+`) ✅. No virtualization (acceptable at these sizes) |
| PDF | Pages rasterized at 2× with `html2canvas` → JPEG per page (`case-pdf.service.js:1156-1168`): large files, text not selectable (L-07) |
| DOM cache | `DOM.qs()` caches every document-level lookup **including `null`** forever (`utils/dom.js:15-21`) — correctness risk (M-15) |

---

# 12. Testing

```text
Tests found:         0
Test framework:      none (no vitest/jest/playwright/cypress in package.json or node_modules/.bin)
Coverage:            0%
CI:                  none (.github/ absent, no pipeline config)
Critical flows:      none covered
```

**Risk:** the highest-risk code (concurrency tokens, list-replace PUTs, 401 refresh serialization, permission gates) has already produced two silent data-loss bugs (BLK-001, BLK-002) that no test would currently catch.

**Recommended minimum before release (H-08):**
1. **Unit (Vitest + jsdom):** `http.js` (401→refresh→retry, concurrent 401s share one refresh, network error during refresh, timeout, non-JSON body), `permissions.js` (`can`, `canAccessView`, `canWriteOpinion` for 3 roles), `utils/nationalId.js`, `personal-data.api.js` payload builders.
2. **Integration (mocked fetch):** edit-case load where `/family-members` fails → **must not** PUT an empty list; 409 on each section save.
3. **E2E smoke (Playwright, staging backend):** login/logout per role, create case through 8 steps, reviewer opinion → manager approval, attachment upload, report CSV export.

---

# 13. Environment & Configuration

| Item | Status |
|---|---|
| Development | `npm run dev` + Vite proxy `/api` → `VITE_API_PROXY_TARGET` (default production host). `secure: false` in the proxy (`vite.config.js:17`), dev only |
| Staging | ❌ **Not configured.** No staging host, and the dev proxy defaults to the same backend as production |
| Production | `VITE_API_BASE_URL=/api/v1` (relative) + host-level reverse proxy (nginx / Vercel rewrite / Netlify redirect) |
| `.env` / `.env.example` | Present. No secrets. `.env` ignored by git and Docker ✅ |
| Env variables | `VITE_API_BASE_URL`, `VITE_API_TIMEOUT_MS`, `VITE_API_EXPORT_TIMEOUT_MS` (all with safe fallbacks). `VITE_API_PROXY_TARGET` (dev only). `API_UPSTREAM` (Docker runtime) |
| Secrets | None in frontend ✅ |
| API URLs | Backend at a generic Hostinger VPS hostname (`srv1990155.hstgr.cloud`), duplicated in 5 files (L-08) |
| `CSV export` base URL | Reads `import.meta.env.VITE_API_BASE_URL` directly instead of `API_BASE_URL` (`reports.service.js:215`). Trailing-slash normalization is skipped |

---

# 14. Build & Deployment

```text
Build command:     npm run build   (vite build)
Build result:      SUCCESS — 476 modules, 5.59 s
Warnings:          "Some chunks are larger than 500 kB" (index 539.7 kB, case-pdf.service 628.6 kB)
Source maps:       not emitted (Vite default) ✅
Lint:              0 errors / 8 warnings
Production config: Dockerfile (multi-stage, node:22-alpine → nginx-unprivileged:1.27, non-root, HEALTHCHECK /healthz),
                   nginx.conf (security headers, cache map, /api proxy with TLS verify, gzip),
                   vercel.json, netlify.toml + public/_headers
```

**Deployment risks**
1. **BLOCKER-003:** `Dockerfile`, `nginx.conf`, `vercel.json`, `netlify.toml`, `public/_headers`, `eslint.config.js`, `src/core/session.js`, `src/utils/{a11y,dialog,error-state}.js` are **untracked**, and 50 files are modified but uncommitted. A CI or host deploy from git would ship HEAD `204f164`: different code, with no security headers or proxy config.
2. HSTS is sent, but TLS terminates *outside* the container. The edge proxy must provide HTTPS.
3. `X-Forwarded-Proto $http_x_forwarded_proto` (`nginx.conf:83`) passes an empty value when no outer proxy sets it.
4. Vercel/Netlify rewrites hard-code the backend host. A host change means code edits in 3 places.
5. No SPA fallback. Correct today because there is no URL routing, but it must be revisited when M-05 is fixed.

---

# 15. Technical Debt

**Critical**
- Wizard save pipeline defeats optimistic concurrency and replaces lists from possibly-failed reads (BLK-001/002).

**High**
- Zero tests and no CI (H-08).
- Tokens in `localStorage` + no cross-tab session coordination (H-02, SEC-01).

**Medium**
- 1,000–1,800-line components mixing DOM, rules and API calls.
- No URL router. Globals on `window`.
- `showToast` defaulting to `success`.
- `DOM.qs` null caching.
- CSV export duplicating HTTP logic outside `HttpClient`.

**Low**
- Dead code: `src/modules/*` (9 files), `state/selectors.js`, `state/signals.js`, store charity/employee actions (`store.js:237-294`), demo-chip handler with no chips (`login.component.js:161-171`), legacy migrations (`store.js:18-22, 46-51`), `'admin'` role check (`sidebar.component.js:153`).
- 8 lint warnings. Inline `style="…"` everywhere, which forces the CSP `style-src 'unsafe-inline'`.
- `FRONTEND_COMPLETE_GUIDE.md` (265 kB) in the repo while the actual API contract docs are missing.

---

# 16. Production Blockers

## 🔴 BLOCKERS

### BLOCKER-001 — Editing a case can silently delete all its family members
File: `src/components/personal-data/case-edit.loader.js` + `src/components/personal-data/personal-data.api.js`
Line: `case-edit.loader.js:355` (+ `:381`), `personal-data.api.js:378-383`

**Problem:**
`loadCaseIntoForm()` does `CasesService.getFamilyMembers(caseId).catch(() => ({ members: [] }))`. A timeout, 5xx, or network blip is turned into "this case has no family members", and the wizard is loaded with an empty list. On Step 1 "الحفظ و التالي", `saveStep1()` **always** calls `PUT /cases/{id}/family-members` with `collectFamilyMembersPayload()`, a full-list replace, so the empty list overwrites the real data. The same pattern affects Step 7 for legacy cases: when `getSupport()` fails and there are no `assessedNeeds`, `fillStep7([])` runs and the Step 7 PUT is empty.

**Impact:** Permanent, silent loss of beneficiary household records in the core business entity. It is triggered by a transient network condition, not by user error.

**Required Fix:**
- In edit mode, do **not** swallow errors on `getFamilyMembers`/`getSupport`. Fail the whole load (`loadCaseIntoForm` already returns `false` and shows a toast).
- Track a `familyLoaded` flag and skip the family PUT unless the list was loaded successfully *or* the user modified it.
- Add a test for this exact path.

**Status:** FIXED in code (2026-09-30), pending manual verification + automated test.
- `case-edit.loader.js`: `getFamilyMembers` failure now aborts the load. `getSupport` failure aborts it only when the case has no `assessedNeeds` (the only case where Step 7 depends on it). The edit context carries `familyLoaded: true`.
- `personal-data.api.js` `saveStep1` (update path): the family-members PUT is skipped in edit mode unless `familyLoaded === true`.

---

### BLOCKER-002 — Optimistic concurrency is bypassed on every list-type section (last write wins)
File: `src/components/personal-data/personal-data.api.js`
Line: `58-61` (`ensureCaseRowVersion`), called at `344, 378, 568, 743, 793, 836`

**Problem:**
Before each list-section PUT (family members, utilities, financial, assessed needs, social-worker assessment), the client re-reads `GET /cases/{id}` and uses the **current** server `rowVersion` as the concurrency token. The token no longer represents the version the user started editing, so the backend's 409 `CONCURRENCY_CONFLICT` protection can never fire. The code comments say this was added to avoid "fake 409s" caused by the shared case-level counter.

**Impact:** When two staff members (e.g. data entry + reviewer) edit the same case, the second save silently overwrites the first user's changes with no warning. This is combined with full-list replace semantics.

**Required Fix:**
- Store `caseRowVersion` when the case/step is **loaded** and update it from each successful PUT response. Send that value; never refetch right before writing.
- If "fake 409s" occur because a previous save in the same session bumped the counter, fix the bookkeeping (update the stored version from every response, which the code already partly does). Confirm the counter semantics with the backend team.
- On a genuine 409: show "someone else changed this case", reload the section, and let the user re-apply.

**Status:** FIXED in code (2026-09-30), pending manual verification + automated test.
- Backend confirmed the semantics: `caseRowVersion` is the case-row xmin, bumped only by list sections and workflow ops. beneficiary/housing/agriculture have independent xmins, and attachments don't touch the case row. The old "fake 409s" were a frontend bug: section `rowVersion`s were written into `caseRowVersion` (old lines 339, 371, 522, 625).
- Backend (commit b231666): `POST /cases` returns `caseRowVersion`, and the 409 `details` carry `section[]` + `currentVersion[]`.
- Frontend: `ensureCaseRowVersion()` removed. `caseRowVersion` now comes from load/create and our own write responses only. On a 409, a three-way dialog appears ("تحميل آخر نسخة" = reset wizard + `loadCaseIntoForm` + return to step / "حفظ بياناتي فوقها" = token from `details.currentVersion`, then retry / cancel). Version tokens are read inside the retried save functions.

---

### BLOCKER-003 — The audited code is not in version control
File: repository root
Line: n/a (`git status`)

**Problem:**
13 files required at runtime or for deployment are untracked (`Dockerfile`, `nginx.conf`, `vercel.json`, `netlify.toml`, `public/_headers`, `.dockerignore`, `eslint.config.js`, `src/core/session.js`, `src/utils/a11y.js`, `src/utils/dialog.js`, `src/utils/error-state.js`), and 50 source files are modified but uncommitted. HEAD (`204f164`) does not contain them.

**Impact:** Any deployment from git (Vercel/Netlify Git integration, CI, another developer's clone) ships older code **without** the CSP/security headers, the same-origin API proxy (so requests fail on CORS), the session teardown, or the error states described in this report. The release is not reproducible.

**Required Fix:** Commit all changes on a release branch, tag the release candidate, and deploy only from that tag.

**Status:** OPEN

---

## 🟠 HIGH PRIORITY

### H-01 — Transient network error during token refresh logs the user out and reloads the page
`src/services/http.js:196-201` → `forceLogout()` → `router.js:295-301` → `session.js:50` (`window.location.reload()`)
Any failure of `/auth/refresh` (including `NetworkError`/`RequestTimeoutError`, not just 401 `TOKEN_*`) clears the session. The page then reloads, so everything typed into the wizard is lost.
**Fix:** Only force logout when refresh returns 401/`TOKEN_EXPIRED|TOKEN_REVOKED|TOKEN_INVALID`. On network/timeout, keep the tokens and surface a retryable error.

### H-02 — Multiple tabs: refresh-token race and no session sync
`src/services/http.js:24-27` (the code's own comment: two concurrent refreshes with the same token → "the loser's whole token family gets revoked"). `refreshInFlight` is per tab. There is no `storage`/`BroadcastChannel` coordination.
Two tabs that hit a 401 in the same window both refresh with the same token → both are logged out. Logging in as user B in one tab leaves another tab rendering user A's UI while it sends B's token.
**Fix:** Use a cross-tab lock (Web Locks API `navigator.locks.request('nahda-refresh', …)`) and re-read the token after acquiring it. Listen to `storage` events on the token/user keys, and reload/redirect when they change.

### H-03 — Wizard input and case context are lost on refresh; no unsaved-changes guard
`src/state/store.js:67-68` persists `currentView`/`activeStage`, while `currentCase` is deliberately in-memory only (`store.js:101`). `workflow.component.js:849-856` restores the step. `app.js:139-141` registers `beforeunload` only for cleanup.
After a refresh on Step 5, the user lands on Step 5 with empty fields and no case ID. Saving then says "complete step 1 first". The draft case already created on the server is orphaned from the UI.
**Fix:** Warn on `beforeunload` when the wizard is dirty. Persist `currentCase.id` in `sessionStorage` and reload it via `loadCaseIntoForm()`, or reset to Step 1 when there's no case context.

### H-04 — Steps 4, 6, 7, 8 fail silently when the pre-save read fails
`src/components/personal-data/personal-data.api.js:568, 743, 793, 836`: `await ensureCaseRowVersion(caseId)` sits **outside** `runSave()`. `workflow.component.js:761-767` has `try/finally` with no `catch`. A network/5xx error becomes an unhandled promise rejection: the button re-enables, no toast is shown, and the user doesn't know the step wasn't saved.
**Fix:** Move the call inside `runSave()` (it is removed anyway by the BLOCKER-002 fix), and add a `catch` in the Next handler.

### H-05 — Case details shows "no family members / no support / no attachments" when those calls fail
`src/components/case-details/case-details.component.js:438-440`: three `.catch(() => empty)` fallbacks. Reviewers and managers make approve/reject decisions and export the official PDF (`:140`) from this screen.
**Fix:** Render a per-section "failed to load, retry" state instead of empty data. Block PDF export while any section failed to load.

### H-06 — Refresh token in `localStorage` (see SEC-01)
Backend dependency: `HttpOnly` cookie for the refresh token. Meanwhile, keep the CSP strict and fix SEC-02.

### H-07 — Charities and employees lists are silently capped at 100
`charities.component.js:298`, `employees.component.js:1011`, `dashboard.component.js:452`, `location-cascade.component.js:44` (`limit: 100`). `case-support-filter.component.js:329` (`limit: 500`, and the server max page size is not verified).
Beyond 100 records, entries are invisible in management screens and **unselectable** in charity dropdowns, with no "showing 100 of N" notice.
**Fix:** Add pagination or "load more" to the management tables. For dropdowns, fetch all pages or use server-side search. Show `totalCount`.

### H-08 — No automated tests and no CI
See §12. Minimum: unit tests for `http.js` and `permissions.js`, integration tests for the BLOCKER-001/002 paths, and one E2E happy path per role. Add CI that runs `npm ci && npm run lint && npm test && npm run build`.

---

## 🟡 MEDIUM PRIORITY

| ID | Finding | Location | Fix |
|---|---|---|---|
| M-01 | Unescaped server fields in `innerHTML` (SEC-02/03/04) | `all-cases.component.js:282-308`, `reports-builder.component.js:156-181, 441-442` | `DOM.escapeHTML()` |
| M-02 | ~60 error/warning toasts use the default `success` style (green check) | `utils/toast.js:377`, e.g. `router.js:21`, `case-details.component.js:447`, `dashboard.component.js:456, 894` | Pass `'error'`/`'warning'`. Consider making `type` required |
| M-03 | Reports dashboards fail silently (console only). KPIs stay at template values | `reports.component.js:268-577` | Reuse `errorStateHTML` + `bindRetry` per tab |
| M-04 | Dashboard KPIs show fake numbers (24 / 1,450 / 38 / 156) while loading | `dash-kpis.html:46, 64, 81, 97` | Replace with a skeleton or "—" |
| M-05 | No URL routing: Back leaves the app, no deep links or shareable case URLs | `core/router.js` (no `history` API), `nginx.conf:106-110` | Hash router (`#/cases/:id`) on top of `switchView` |
| M-06 | Role gating inconsistent: sidebar hides Reports from reviewer/data_entry, but `canAccessView('reports')` allows them. `can()` grants report permissions client-side beyond the server list. Legacy `'admin'` check | `sidebar.component.js:151-155`, `permissions.js:171-181` | Drive the sidebar from `canAccessView()`. Remove client-side grants once the server sends them |
| M-07 | Presigned uploads: no timeout, no byte progress, no cancel | `attachments.service.js:89-98`, `profile.service.js:74-83` | `XMLHttpRequest` with `upload.onprogress` + `AbortController` timeout |
| M-08 | Plaintext credentials shared via WhatsApp/clipboard (SEC-05) | `employees.component.js:396-493` | Force password change on first login (backend) |
| M-09 | No production error monitoring. No global `error`/`unhandledrejection` handler | grep: none in `src/` | Add Sentry (or equivalent) with PII scrubbing, since the app handles national IDs |
| M-10 | Shell not responsive on phones: the fixed sidebar (84/290 px) and `.main-wrapper` right margin have no mobile breakpoint. At 360 px, content is ≈188 px wide. **Not visually verified** | `layout.css:4-19`, `sidebar.css:4-28` (0 media queries) | Off-canvas sidebar under 768 px. Lower priority if the web app is desktop-only by policy |
| M-11 | `vite` dev-server advisories (SEC-06) | `package.json:16` | Upgrade vite |
| M-12 | `html2canvas` imported but not declared (optional dep of jspdf). `npm ci --omit=optional` would break the build | `case-pdf.service.js:16`, `package.json` | `npm i html2canvas` |
| M-13 | CSV export bypasses `HttpClient`: no 401 refresh (fails after 15 min of token age), throws plain `Error`, ignores `API_BASE_URL` normalization | `reports.service.js:214-256` | Add a `blob` mode to `request()` |
| M-14 | Main chunk 540 kB. Every view is initialized at boot for every role | build output, `app.js:98-129` | Lazy-init reports/employees/state-mgmt on first `switchView` |
| M-15 | `DOM.qs()` permanently caches `null` and detached nodes | `utils/dom.js:15-21` | Don't cache misses. Verify `isConnected` on hit |

## 🟢 LOW PRIORITY

| ID | Finding | Location |
|---|---|---|
| L-01 | Dead code: `src/modules/*` (9 files, none imported), `state/selectors.js`, `state/signals.js`, store charity/employee actions, demo-chip handler, legacy migrations | see §15 |
| L-02 | Notifications bell button with no behaviour | `layout/header/header.html:11` |
| L-03 | Hotlinked Unsplash stock photo as default avatar (SEC-07) | `sidebar.component.js:135` + 3 more |
| L-04 | `index.html`: generic title "Enterprise SaaS Dashboard", no favicon (404 on `/favicon.ico`), no `<meta name="robots" content="noindex">` for an internal app | `index.html:7` |
| L-05 | Inline `onerror=` in PDF templates is blocked by the CSP (console violations; handler never runs) | `case-pdf.service.js:113, 143, 145, 180` |
| L-06 | 19 unlabeled "other" inputs. Keyboard-inaccessible sidebar footer `<div>` | §10 |
| L-07 | PDF is rasterized JPEG (not searchable, large) | `case-pdf.service.js:1156-1168` |
| L-08 | Backend host hard-coded in 5 files; generic VPS hostname instead of an owned domain | §13 |
| L-09 | Empty 2xx body (e.g. 204) is thrown as an error. **Not verified** whether any endpoint returns 204 | `http.js:67-72` |
| L-10 | No proactive token refresh (`isAccessTokenExpiring` unused) | `tokens.js:23-27` |
| L-11 | Unused fonts (`src/assets/fonts/*`), duplicate image (`background.jpg` ≡ `pageground.jpg`) | `public/assets`, `src/assets/fonts` |
| L-12 | 8 ESLint warnings | `case-details.component.js:235`, `dashboard.component.js:847`, `case-edit.loader.js:246`, `workflow.component.js:926, 1055`, `case-pdf.service.js:1043, 1095` |
| L-13 | API contract docs referenced 24× in code are not in the repo. README has no dev/test/architecture sections | `WEB_API_DOCUMENTATION.md` (missing) |
| L-14 | Opening a case: no loading indicator and no double-click guard | `all-cases.component.js:331-335` |

---

# 17. Priority Fix Plan

## Phase 1 — Before Production (must fix)
1. BLOCKER-003: commit everything and tag an RC.
2. BLOCKER-001: stop swallowing family/support read errors in edit mode; skip the list PUT unless loaded or modified.
3. BLOCKER-002: correct `caseRowVersion` bookkeeping, remove the pre-write refetch, handle a real 409 (confirm semantics with the backend).
4. H-04: errors in step saves always surface to the user.
5. H-01: logout only on auth-token errors, never on network errors.
6. H-05: per-section error states in case details; block PDF export on partial data.
7. H-07: paginate charities/employees; complete charity dropdowns.
8. M-01: escape the remaining server fields.
9. M-12: declare `html2canvas`.
10. H-08 (minimum): tests for items 2–5 + CI running lint/test/build.

## Phase 2 — Release Candidate (test before release)
- H-02 cross-tab refresh lock + session sync. H-03 unsaved-changes guard + wizard context restore.
- M-02 toast types. M-03 reports error states. M-04 KPI skeletons. M-06 sidebar/permission consistency. M-13 CSV via HttpClient.
- Verify against the real backend: 403 on every protected endpoint for each role (the frontend gates are not a security boundary), max `limit` per list endpoint, any 204 responses (L-09), rowVersion semantics.
- M-09 error monitoring. Confirm HTTPS at the edge and HSTS.
- Manual pass on target browsers and screen sizes (responsive layout was not visually verified in this audit).

## Phase 3 — Post Launch
- H-06 HttpOnly refresh cookie (backend work). M-05 URL routing. M-07 upload progress/cancel. M-10 mobile shell. M-11 vite upgrade. M-14 lazy views. M-15 `DOM.qs`.
- All Low items. Split the giant components. Vector-text PDF.

---

# 18. Final Checklist

- [x] Build passes (`vite build`, 0 errors; chunk-size warning only)
- [ ] Production environment configured — configs exist but are **uncommitted** (BLOCKER-003); no staging environment
- [x] No development URLs (no localhost/IP/HTTP URLs in `src/`)
- [x] No secrets exposed (none found in source, env files, or build)
- [x] Authentication verified (static review: login, `/auth/me` boot guard, refresh, logout)
- [x] Logout verified (static: server revoke + full client wipe + reload)
- [ ] Protected routes verified — client gates reviewed; **backend enforcement not verified**; sidebar inconsistent (M-06)
- [ ] API errors handled — gaps: H-04, H-05, M-03, M-13
- [ ] Loading states complete — gaps: M-04, L-14
- [ ] Empty states complete — lists ✅; case-details shows false empties (H-05)
- [ ] Responsive layout verified — not visually tested; static analysis shows no phone layout (M-10)
- [ ] Accessibility reviewed — static review done; screen-reader/axe run not done
- [ ] Critical flows tested — **no tests exist**
- [x] Console cleaned — no `console.log`/`debug`; 27 `console.warn/error` calls (acceptable, but no monitoring)
- [ ] Assets optimized — duplicate/unused assets; 540 kB main chunk
- [ ] Deployment verified — not deployed during audit; the deploy source is not in git

---

# 19. Final Verdict

```text
PRODUCTION STATUS:
NOT PRODUCTION READY

READINESS:
55%

CRITICAL BLOCKERS:
3

HIGH PRIORITY:
8

MEDIUM PRIORITY:
15

LOW PRIORITY:
14
```

### Scorecard (evidence-based, 0–10)

| Category | Score | Evidence | Problems |
|---|:-:|---|---|
| Architecture | 6 | Clean service layer, EventBus, isolated bootstrap | 1–1.8k-line components, window globals, no URL routing |
| Code Quality | 6.5 | ESLint 0 errors; thorough intent comments | Dead code, no types, 8 warnings |
| Functionality | 6 | All screens wired to real APIs; no mock data left | Data-loss paths, 100-row caps, dead bell |
| API Integration | 6 | Timeout, envelope, typed errors, refresh serialization | Concurrency bypass, swallowed reads, CSV bypass |
| Authentication | 6 | Boot guard, clean logout, role rejection | localStorage tokens, cross-tab race, network→logout |
| Security | 6.5 | CSP + headers on all targets, broad escaping, no secrets | Token storage, 4 unescaped sinks, credential sharing |
| Error Handling | 6 | Error taxonomy + retry states on 4 lists | Silent reports, unhandled rejections, success-styled errors |
| UX/UI | 6 | Validation gates, confirm dialogs, empty states | Fake KPI numbers, unsaved-data loss |
| Responsive | 4 | Many component breakpoints | No phone shell layout; not visually verified |
| Accessibility | 6.5 | Focus trap / inert / live regions; all icon buttons named | 19 unlabeled inputs, toast semantics, div link |
| Performance | 6 | PDF lazy chunk, sane caching headers | 540 kB eager main chunk, eager inits |
| Testing | 0 | — | No tests, no CI |
| Build/Deployment | 8 | Build OK; hardened Docker/nginx/Vercel/Netlify | Uncommitted; no staging |
| Configuration | 7.5 | Relative API base, env fallbacks, `.env.example` | Host duplicated in 5 files |
| Observability | 2 | Bootstrap failure toast | Console only; no monitoring |
| Documentation | 5 | README deploy table; very long guide | API contract missing; no dev/test docs |
| **Overall** | **5.5 → 55%** | Mean of 16 categories | **Overridden by 3 critical blockers** |

**Why:** the infrastructure layer (HTTP client, session teardown, security headers, deployment configs) is close to production quality. The product's core workflow is not. Editing a case can silently erase its family members or overwrite a colleague's changes. The release artifact isn't in version control, and nothing is covered by automated tests. Fix the three blockers and the H-01/H-04/H-05 error paths and this becomes a realistic *ready with minor fixes* candidate.

---

# 🚀 EXACT ACTION PLAN

1. **Commit & tag** — `git checkout -b release/rc1 && git add -A && git commit` (includes Dockerfile, nginx.conf, vercel.json, netlify.toml, public/_headers, session.js, a11y.js, dialog.js, error-state.js). Deploy only from the tag. *(BLOCKER-003)*
2. **`case-edit.loader.js:355-357`** — remove the `.catch(() => ({ members: [] }))` and `.catch(() => ({ recommendations: [] }))` fallbacks so a failed read aborts `loadCaseIntoForm()`. Set `store.currentCase.familyLoaded = true` on success. *(BLOCKER-001)*
3. **`personal-data.api.js:342-351, 373-383`** — only call `updateFamilyMembers` when `familyLoaded === true` or the family list was edited in this session (track a dirty flag in `family-members.component.js` via `store.setFamilyMembers`). *(BLOCKER-001)*
4. **`personal-data.api.js:58-61`** — delete `ensureCaseRowVersion()` and its 6 call sites. Initialize `caseRowVersion` on load (`case-edit.loader.js:377`, already done) and after `POST /cases`; update it from **every** PUT response (`beneficiary`, `housing`, `agriculture` included). In `runSave`'s `onConflict`, show "تم تعديل الحالة من مستخدم آخر" and reload the section via `loadCaseIntoForm()`. Confirm with the backend whether `beneficiary.rowVersion` and `rowVersion` share a counter. *(BLOCKER-002, H-04)*
5. **`workflow.component.js:761-767`** — add `catch (err) { showToast(messageFromError(err), 'error'); return; }` to the Next handler. *(H-04)*
6. **`http.js:197-201`** — in the refresh `catch`, call `forceLogout()` only when `refreshErr instanceof ApiError && refreshErr.httpStatus === 401`. Otherwise rethrow without clearing tokens. *(H-01)*
7. **`case-details.component.js:436-445`** — keep `{ ok:false, error }` per secondary section, render `errorStateHTML(err, 'أفراد الأسرة', {compact:true})` in that section, and disable `#btn-export-case-pdf` while any section failed. *(H-05)*
8. **`charities.component.js:295-299`, `employees.component.js:1008-1012`** — add page state + "load more" using `result.totalCount`. **`dashboard.component.js:452`, `location-cascade.component.js:44`** — loop pages until `items.length === totalCount`. Confirm the server's max `limit` (the 500 at `case-support-filter.component.js:329`). *(H-07)*
9. **`all-cases.component.js:282, 285, 292, 308`** and **`reports-builder.component.js:156, 173, 181, 441, 442`** — wrap interpolations in `DOM.escapeHTML()`. *(M-01)*
10. **`npm i html2canvas@1.4.1`** so it's a declared dependency. *(M-12)*
11. **Add tests:** `npm i -D vitest jsdom`, add `"test": "vitest run"`. Write specs for `http.js` (refresh/retry/network-during-refresh), `permissions.js`, and the BLOCKER-001/002 scenarios with mocked `fetch`. Add CI: `npm ci && npm run lint && npm test && npm run build`. *(H-08)*
12. **`http.js` refresh** — wrap `refreshSession()` in `navigator.locks.request('nahda-refresh', …)` and re-read the refresh token inside the lock. If it changed, skip the network call. Add `window.addEventListener('storage', …)` for `nahda_refresh_token`/`nahda_current_user` → reload. *(H-02)*
13. **Wizard guard** — set a dirty flag on `input`/`change` inside `#view-personal-data`. Add `beforeunload` to warn when dirty. Persist `currentCase.id` in `sessionStorage` and, on boot in `personal-data`, call `loadCaseIntoForm(id)`; else force Step 1. *(H-03)*
14. **`utils/toast.js:377`** — make `type` required (or default to `'info'`), then fix the ~60 error/warning call sites (`grep -rnE "showToast\((.*)\);" src | grep -E "تعذر|⚠️|الرجاء|يرجى"`). *(M-02)*
15. **`reports.component.js`** — in every `catch` (lines 268–577), render `errorStateHTML(err, '<tab name>')` into the tab container with `bindRetry`. *(M-03)*
16. **`dash-kpis.html:46, 64, 81, 97`** — replace `24 / 1,450 / 38 / 156` with `—` and a skeleton class. *(M-04)*
17. **`sidebar.component.js:151-155`** — `reportsGroup.style.display = canAccessView('reports') ? 'block' : 'none'`. Drop the `'admin'` check. *(M-06)*
18. **`reports.service.js:214-256`** — route the CSV export through `request()` with a `responseType: 'blob'` option so it gets 401 refresh and `ApiError` mapping. *(M-13)*
19. **Monitoring** — add Sentry (or equivalent) with `beforeSend` scrubbing of national IDs, phones and emails, plus `window.addEventListener('unhandledrejection', …)`. *(M-09)*
20. **Backend verification session** (checklist for the API team): refresh token as an HttpOnly cookie (H-06), 403 enforcement per role on every endpoint, max page `limit`, 204 usage (L-09), rowVersion semantics (BLOCKER-002), first-login password change (M-08), and HTTPS termination in front of the container.
21. **Cleanup** — delete `src/modules/`, `state/selectors.js`, `state/signals.js`, unused store actions, the demo-chip handler, `src/assets/fonts/`, and `public/assets/pageground.jpg` (a byte-identical copy of `background.jpg`, not referenced anywhere). Fix the 8 lint warnings. Add a favicon, a real `<title>`, and `noindex`. Ship a local default avatar. *(L-01…L-12)*
