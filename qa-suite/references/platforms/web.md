# Platform: Web

Platform-specific checklists for web apps. Read this before running bob-qa,
smoke-qa, performance-qa, security-qa, or compatibility-qa against a web
target. Each section plugs into the correspondingly named agent.

## smoke-qa — startup checks

- Start command succeeds (no error exit code); services report
  healthy/running.
- Startup logs: no crash loop, no repeated error stack traces.
- App URL returns a successful response, page has a `<title>`, no blank
  white screen.
- Browser load (if tooling available): no console errors on initial load.

## bob-qa — accessibility checklist (WCAG 2.2 Level AA)

Spot-check at minimum, reporting each as Pass / Fail / N-A with the
criterion number:

| Criterion | Check |
|---|---|
| 1.4.3 Contrast (Minimum) | Text ≥4.5:1, large text ≥3:1 |
| 2.1.1 Keyboard | Every interactive element reachable and operable without a mouse |
| 2.4.7 Focus Visible | Visible focus indicator on all focusable elements |
| 2.5.8 Target Size (Minimum) (WCAG 2.2 AA) | Interactive targets ≥24×24 CSS px, or exempt via sufficient spacing/inline placement; ≥44×44px recommended (2.5.5 AAA) |
| 4.1.2 Name, Role, Value | Controls expose accessible name and role (ARIA or native semantics) |

Automated assist where available: axe-core, Lighthouse accessibility audit,
pa11y. Automated results supplement — they don't replace — the manual
keyboard and focus checks.

## bob-qa — visual weirdness sweep

Design oracle: the project's own design tokens/docs when defined, otherwise
WCAG 2.2 AA + Nielsen H4/H8 for consistency; no single vendor system is
assumed. Evidence per finding: screenshot.

Use project design docs, design tokens, and acceptance criteria first. Use
these platform checks only when project-specific visual oracles do not
answer the question. Cite the stable ID for matched checks; otherwise report
the visible symptom plainly without inventing a standard.

| ID | Check |
|---|---|
| VW-WEB-01 | Interactive targets ≥24×24 CSS px (WCAG 2.2 2.5.8 AA; ≥44px recommended per 2.5.5 AAA), adjacent targets not overlapping |
| VW-WEB-02 | Text truncation, overlap, or clipping at default zoom |
| VW-WEB-03 | Page usable at 200% browser zoom and 320px-wide viewport without loss of content or function (WCAG 1.4.10 Reflow); no horizontal scroll for vertical content |
| VW-WEB-04 | Spacing/alignment consistency: same component type rendered with consistent padding, size, and style across pages (Nielsen H4) |
| VW-WEB-05 | Dark mode / theme toggle (if present): all text and controls readable and visible |
| VW-WEB-06 | Window resize across breakpoints: no broken layout, overlapping elements, or dead zones between defined breakpoints |
| VW-WEB-07 | Images/icons: no stretching, squashing, or visible low-resolution scaling |
| VW-WEB-08 | Empty, loading, and error states render intentionally — not blank screens or raw exception text |
| VW-WEB-09 | Long-string overflow: fields and labels tested with a realistic 3x-length string wrap or truncate gracefully |
| VW-WEB-10 | Text contrast ≥4.5:1 (≥3:1 large text) (WCAG 1.4.3); non-text UI element contrast ≥3:1 (WCAG 1.4.11) |
| VW-WEB-11 | Focus/hover/disabled states visually distinct and consistent across the app |

## performance-qa — metrics

- **PERF-WEB-01 Cold start:** time from app start to first successful HTTP
  response.
- **PERF-WEB-02 Warm latency:** 20–50 sequential requests to the main page and key
  endpoints; report p50/p95.
- **PERF-WEB-03 Concurrency:** light HTTP load test (autocannon, k6) at the level from
  qa-context.md; report req/sec, error rate, latency distribution.
- **PERF-WEB-04 Frontend:** Lighthouse/Web Vitals metrics — report LCP,
  INP, CLS, and the tool context, not just an aggregate score.
- **PERF-WEB-05 Resources under load:** container/process CPU% and memory, noting
  upward trends (leak) vs. plateau.

No-baseline defaults: Core Web Vitals pass only when LCP ≤2.5s, INP
<200ms, and CLS <0.1 at p75. INP replaced FID in March 2024; ignore
unofficial "Core Web Vitals 2.0" blog metrics. Project baselines override
these defaults once present.

## security-qa — surface checks

These checks are security hygiene, not a pentest. ASVS references are
OWASP ASVS 5.0.0 topic areas, not compliance claims.

| ID | Check | ASVS 5.0.0 topic area |
|---|---|---|
| SEC-WEB-01 | Dependency audit (`npm audit` or ecosystem equivalent from qa-context.md); cite only actual tool output for CVE, severity, affected version, or CWE. | V15 Secure Coding and Architecture |
| SEC-WEB-02 | Exposed routes: debug endpoints, admin panels, unauthenticated API routes that docs say need auth. | V8 Authorization; V13 Configuration |
| SEC-WEB-03 | Security headers on the main response: CSP, X-Frame-Options / frame-ancestors, X-Content-Type-Options, HSTS (if HTTPS). Weigh absence against the threat model — a VPN-only tool has a different bar than a public endpoint. | V3 Web Frontend Security; V12 Secure Communication; V13 Configuration |
| SEC-WEB-04 | Secrets hygiene in the repo: committed env files, hardcoded keys, credentials in compose/config. Reference file/line, never print values. | V11 Cryptography; V14 Data Protection |
| SEC-WEB-05 | CORS wider than the deployment model calls for. | V12 Secure Communication; V13 Configuration |
| SEC-WEB-06 | Documented default credentials still active (no brute-forcing). | V6 Authentication; V13 Configuration |

## compatibility-qa — matrix

**Axis 1 — engines:** Chromium, WebKit, Firefox (whichever are actually
installed/available via the project's tooling).

**Axis 2 — viewports:** 320px, 375px, 768px, 1024px, 1440px — or the
project's own CSS breakpoints if defined.

Method: each core flow once per engine at 1440px (engine bugs), then once
per viewport on Chromium (responsive bugs). Full cross product only on
explicit request or when a prior pass found engine-specific responsive
bugs. Emulated viewports are labeled **emulated**, never "tested on
mobile."
