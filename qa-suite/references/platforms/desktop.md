# Platform: Desktop

Checklists for desktop apps (Electron, Tauri, JavaFX/Swing, Qt, native).
Where the app is a web view in a shell (Electron/Tauri), also apply the
relevant parts of `web.md` to the rendered content — but keep the shell
checks below.

## smoke-qa — startup checks

- Build/package succeeds; app launches to first window without crash.
- Stdout/stderr or app log over the launch window: no fatal errors, no
  crash loop.
- One representative action per core flow.

## bob-qa — accessibility checklist (desktop)

| Check | Standard |
|---|---|
| Screen reader | Elements exposed with names/roles via the platform accessibility API (NVDA/Narrator on Windows, VoiceOver on macOS, Orca on Linux — whichever the test OS provides) |
| Keyboard-only operation | Full app operable without a mouse; no keyboard traps |
| Focus visibility | Visible focus indicator on all focusable controls |
| Text contrast | ≥4.5:1 normal, ≥3:1 large text |
| OS text/display scaling | Layout survives 150–200% OS scaling without clipping |

For web-view shells, also run the WCAG table from `web.md` against the
rendered content.

## bob-qa — visual weirdness sweep

Design oracle: the project's own design tokens/docs when defined, otherwise
the OS convention (Windows Fluent: targets ≥40epx; macOS HIG; GNOME HIG).
Evidence per finding: screenshot. Web-view shells (Electron/Tauri) also
apply the web sweep from `web.md` to rendered content.

Use project design docs, design tokens, and acceptance criteria first. Use
these platform checks only when project-specific visual oracles do not
answer the question. Cite the stable ID for matched checks; otherwise report
the visible symptom plainly without inventing a standard.

| ID | Check |
|---|---|
| VW-DSK-01 | Click/touch targets meet the OS convention minimum (Fluent ≥40epx; HIG 44pt-equivalent for touch-capable targets) |
| VW-DSK-02 | Text truncation, overlap, or clipping at default settings |
| VW-DSK-03 | Layout survives 150–200% OS display scaling and large system font settings without clipping or overlap |
| VW-DSK-04 | Window resize: usable at smallest supported size; no broken layout, clipped controls, or dead space at large sizes |
| VW-DSK-05 | Spacing/alignment consistency: same component type rendered with consistent padding, size, and style across views |
| VW-DSK-06 | Dark mode / OS theme (if supported): all text and controls readable and visible |
| VW-DSK-07 | Images/icons: no stretching, squashing, or low-resolution scaling, including on high-DPI displays |
| VW-DSK-08 | Empty, loading, and error states render intentionally — not blank panes or raw error dumps |
| VW-DSK-09 | Long-string overflow: fields and labels tested with a realistic 3x-length string wrap or truncate gracefully |
| VW-DSK-10 | Text contrast ≥4.5:1 (≥3:1 large text); non-text UI element contrast ≥3:1 |

## performance-qa — metrics

- **PERF-DSK-01 Cold start:** launch to interactive window, wall-clock
  measured, averaged over 3+ runs.
- **PERF-DSK-02 Memory and CPU** at idle and during core flows (OS process monitor or
  framework tooling); trend vs. plateau.
- **PERF-DSK-03 Bundle/installer size** vs. prior baseline if releases are in scope.
- **PERF-DSK-04 Electron/Tauri renderer-process metrics** via the embedded
  DevTools where available.

No-baseline defaults: there is no public named desktop threshold. The first
run is baseline-only unless the project provides explicit targets. Project
baselines override this default once present.

## security-qa — surface checks

These checks are security hygiene, not a pentest. ASVS references are
OWASP ASVS 5.0.0 topic areas, not compliance claims.

| ID | Check | ASVS 5.0.0 topic area |
|---|---|---|
| SEC-DSK-01 | Dependency audit per ecosystem (npm audit for Electron, cargo audit for Tauri, ecosystem tool otherwise); cite only actual tool output for CVE, severity, affected version, or CWE. | V15 Secure Coding and Architecture |
| SEC-DSK-02 | Electron-specific: `nodeIntegration` off, `contextIsolation` on, no loading of remote content with node access; Tauri: allowlist/capability scope review. | V3 Web Frontend Security; V13 Configuration |
| SEC-DSK-03 | Secrets hygiene in repo and packaged artifacts; reference file/line, never print values. | V11 Cryptography; V14 Data Protection |
| SEC-DSK-04 | Auto-update channel integrity (HTTPS, signature verification) if the app self-updates. | V12 Secure Communication; V15 Secure Coding and Architecture |
| SEC-DSK-05 | Local data storage location and permissions for sensitive data, per threat model. | V14 Data Protection |
| SEC-DSK-06 | Documented default credentials still active (no brute-forcing). | V6 Authentication; V13 Configuration |

## compatibility-qa — matrix

**Axis 1 — OS:** the OSes the app claims to support (Windows/macOS/Linux),
tested only where actually available — claim nothing for an OS you didn't
run.
**Axis 2 — display:** one standard resolution, one high-DPI/scaled
configuration, smallest supported window size (resize behavior, clipping).

Same two-pass method; note which OSes were unavailable rather than
silently skipping.
