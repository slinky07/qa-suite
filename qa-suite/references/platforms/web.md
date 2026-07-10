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
| 2.5.8 Target Size (Minimum) (WCAG 2.2 AA) | Touch targets meet WCAG 2.2 AA minimum target-size requirements |
| 4.1.2 Name, Role, Value | Controls expose accessible name and role (ARIA or native semantics) |

Automated assist where available: axe-core, Lighthouse accessibility audit,
pa11y. Automated results supplement — they don't replace — the manual
keyboard and focus checks.

## bob-qa — visual weirdness sweep

Use project design docs, design tokens, and acceptance criteria first. Use
these platform checks only when project-specific visual oracles do not
answer the question. Cite the stable ID for matched checks; otherwise report
the visible symptom plainly without inventing a standard.

| ID | Check |
|---|---|
| VIS-WEB-01 | Responsive layout: no overlapping, clipping, unintended horizontal scroll, or orphaned controls at tested viewports |
| VIS-WEB-02 | Text containment: labels, headings, button text, and validation messages remain readable without unintended truncation |
| VIS-WEB-03 | Interaction states: hover, focus, active, disabled, selected, and loading states are visually distinct and aligned with the design system |
| VIS-WEB-04 | Forms and feedback: errors, helper text, and success states appear near the triggering control without hiding the next action |
| VIS-WEB-05 | Empty, loading, and error states: state-specific UI is visible, stable, and not mistaken for broken layout |
| VIS-WEB-06 | Media and icons: images, icons, canvas, charts, and video render at intended size, aspect ratio, and resolution |

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
