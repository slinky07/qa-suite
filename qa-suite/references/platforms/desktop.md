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

Use project design docs, design tokens, and acceptance criteria first. Use
these platform checks only when project-specific visual oracles do not
answer the question. Cite the stable ID for matched checks; otherwise report
the visible symptom plainly without inventing a standard.

| ID | Check |
|---|---|
| VIS-DSK-01 | Window resizing: core screens remain usable at the smallest supported window and common high-DPI/scaled configurations |
| VIS-DSK-02 | Native chrome and content: title bars, menus, toolbars, sidebars, and web-view content do not overlap or create double navigation |
| VIS-DSK-03 | Text and controls: labels, menu items, shortcuts, dialogs, and buttons remain readable without unintended truncation |
| VIS-DSK-04 | Modal and popover placement: dialogs, context menus, tooltips, and popovers stay anchored and visible within the active display |
| VIS-DSK-05 | State transitions: launch, loading, empty, error, update, and offline states are visibly distinct and do not look like crashes |
| VIS-DSK-06 | Platform fit: spacing, density, focus rings, and disabled/selected states match the app's stated desktop design system or host OS conventions |

## performance-qa — metrics

- Cold start: launch to interactive window, wall-clock measured, averaged
  over 3+ runs.
- Memory and CPU at idle and during core flows (OS process monitor or
  framework tooling); trend vs. plateau.
- Bundle/installer size vs. prior baseline if releases are in scope.
- Electron/Tauri: renderer-process metrics via the embedded DevTools where
  available.

## security-qa — surface checks

1. Dependency audit per ecosystem (npm audit for Electron, cargo audit for
   Tauri, ecosystem tool otherwise).
2. Electron-specific: `nodeIntegration` off, `contextIsolation` on, no
   loading of remote content with node access; Tauri: allowlist/capability
   scope review.
3. Secrets hygiene in repo and packaged artifacts; reference file/line,
   never print values.
4. Auto-update channel integrity (HTTPS, signature verification) if the
   app self-updates.
5. Local data storage location and permissions for sensitive data, per
   threat model.
6. Documented default credentials still active.

## compatibility-qa — matrix

**Axis 1 — OS:** the OSes the app claims to support (Windows/macOS/Linux),
tested only where actually available — claim nothing for an OS you didn't
run.
**Axis 2 — display:** one standard resolution, one high-DPI/scaled
configuration, smallest supported window size (resize behavior, clipping).

Same two-pass method; note which OSes were unavailable rather than
silently skipping.
