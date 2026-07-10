# Platform: Android

Platform-specific checklists for Android apps. Read this before running
bob-qa, smoke-qa, performance-qa, security-qa, or compatibility-qa against
an Android target. Assumes an emulator or explicitly-scoped test device via
`adb`; never a personal daily-driver device unless the user scopes it.

## smoke-qa — startup checks

- Build succeeds (`./gradlew assembleDebug` or the project's command); no
  error exit code.
- `adb install` (or emulator deploy) succeeds.
- App launches to its first screen without crash or ANR.
- `adb logcat` over the launch window: no fatal exceptions, no crash loop.
- One representative action per core flow — just "is it alive."

## bob-qa — accessibility checklist (Android)

WCAG web criteria don't apply directly; use the Android equivalents,
reporting each as Pass / Fail / N-A:

| Check | Standard |
|---|---|
| TalkBack navigation | Every interactive element reachable and announced with a meaningful label (contentDescription / semantics) |
| Touch target size | ≥48×48dp (Material guidelines) |
| Text contrast | ≥4.5:1 normal text, ≥3:1 large text (same ratios as WCAG 1.4.3) |
| Dynamic text scaling | Layout survives system font size at maximum without clipping or overlap |
| Focus order | Logical traversal order under TalkBack / keyboard (if hardware keyboard supported) |
| State announcement | Toggles, checkboxes, and custom controls announce state changes |

Automated assist: Google's Accessibility Scanner, or Espresso's
`AccessibilityChecks.enable()`. Supplements, not replaces, manual TalkBack
passes.

## bob-qa — visual weirdness sweep

Design oracle: the project's own design tokens/docs when defined, otherwise
Material Design 3 (m3.material.io). Evidence per finding: screenshot.

Use project design docs, design tokens, and acceptance criteria first. Use
these platform checks only when project-specific visual oracles do not
answer the question. Cite the stable ID for matched checks; otherwise report
the visible symptom plainly without inventing a standard.

| ID | Check |
|---|---|
| VW-AND-01 | Touch targets ≥48×48dp (M3 accessibility), adjacent targets separated ≥8dp |
| VW-AND-02 | Text truncation, overlap, or clipping at default font scale |
| VW-AND-03 | Layout survives maximum system font size and display size without clipping, overlap, or lost controls |
| VW-AND-04 | Keyboard (IME) does not occlude the focused input; content scrolls or resizes |
| VW-AND-05 | Content respects insets/cutouts: nothing hidden behind status bar, navigation bar, or camera cutout |
| VW-AND-06 | Spacing/alignment consistency: same component type rendered with consistent padding, size, and style across screens (M3 spacing uses 4dp increments — flag visibly arbitrary/mixed spacing, not exact-dp pedantry) |
| VW-AND-07 | Dark theme: all text and controls readable and visible; no invisible-on-background elements |
| VW-AND-08 | Rotation (if supported): layout reflows without breakage or state loss |
| VW-AND-09 | Images/icons: no stretching, squashing, or visible low-resolution scaling |
| VW-AND-10 | Empty, loading, and error states render intentionally — not blank or broken screens |
| VW-AND-11 | Long-string overflow: fields and labels tested with a realistic 3x-length string wrap or ellipsize gracefully |
| VW-AND-12 | Text contrast ≥4.5:1 (≥3:1 large text); non-text UI element contrast ≥3:1 |

## performance-qa — metrics

- **PERF-AND-01 Cold / warm / hot startup:** `adb shell am start -W`
  reported times, or Macrobenchmark if the project has it.
- **PERF-AND-02 Jank:** frame metrics during core flows (`adb shell dumpsys gfxinfo
  <package>` or Perfetto) — report janky-frame percentage, not an
  impression of smoothness.
- **PERF-AND-03 Memory:** `adb shell dumpsys meminfo <package>` sampled across a flow;
  note upward trend vs. plateau. LeakCanary findings if the project bundles
  it.
- **PERF-AND-04 APK/AAB size** vs. prior baseline, if release builds are in scope.
- Client-side "concurrent load" mostly doesn't apply; if the app has a
  backend, load-test that via api-qa/performance-qa against the backend URL
  instead.

No-baseline defaults: no ANR during tested flows. Android vitals treats
startup as excessive at cold ≥5s, warm ≥2s, and hot ≥1.5s. Project
baselines override these defaults once present.

## security-qa — surface checks

These checks are security hygiene, not a pentest. MASVS references are
OWASP MASVS v2.1.0 control groups, not compliance claims.

| ID | Check | MASVS v2.1.0 category |
|---|---|---|
| SEC-AND-01 | Dependency audit: Gradle dependency verification / OWASP dependency-check plugin / `gradle dependencyUpdates`; cite only actual tool output for CVE, severity, affected version, or CWE. | MASVS-CODE: Code Quality |
| SEC-AND-02 | Manifest review: exported activities/services/receivers that shouldn't be; `android:debuggable` in release config; `usesCleartextTraffic`; over-broad permissions vs. what the app actually does. | MASVS-PLATFORM: Platform Interaction; MASVS-NETWORK: Network Communication; MASVS-PRIVACY: Privacy |
| SEC-AND-03 | Secrets hygiene: hardcoded API keys in source, `local.properties` or keystores committed, secrets baked into the APK (strings/resources). Reference file/line, never print values. | MASVS-STORAGE: Storage; MASVS-CRYPTO: Cryptography; MASVS-AUTH: Authentication and Authorization |
| SEC-AND-04 | Network security config: cleartext allowed where it shouldn't be, missing certificate pinning only if the threat model calls for it. | MASVS-NETWORK: Network Communication |
| SEC-AND-05 | Backup/export: `allowBackup` implications for sensitive data, given the threat model. | MASVS-STORAGE: Storage; MASVS-PRIVACY: Privacy |
| SEC-AND-06 | Documented default credentials still active (no brute-forcing). | MASVS-AUTH: Authentication and Authorization |

## compatibility-qa — matrix

**Axis 1 — API levels:** minSdk, targetSdk, and one mid-range level in
between (from the project's Gradle config).

**Axis 2 — form factors/densities:** small phone (~360dp width), standard
phone, tablet (if the app claims tablet support), portrait + landscape if
rotation is supported.

Method: each core flow once per API level at standard phone size, then once
per form factor at targetSdk. Full cross product only on explicit request.
Emulator coverage is labeled **emulated**; only claim real-device coverage
for devices actually used.
