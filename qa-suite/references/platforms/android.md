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

## performance-qa — metrics

- **Cold / warm / hot startup:** `adb shell am start -W` reported times, or
  Macrobenchmark if the project has it.
- **Jank:** frame metrics during core flows (`adb shell dumpsys gfxinfo
  <package>` or Perfetto) — report janky-frame percentage, not an
  impression of smoothness.
- **Memory:** `adb shell dumpsys meminfo <package>` sampled across a flow;
  note upward trend vs. plateau. LeakCanary findings if the project bundles
  it.
- **APK/AAB size** vs. prior baseline, if release builds are in scope.
- Client-side "concurrent load" mostly doesn't apply; if the app has a
  backend, load-test that via api-qa/performance-qa against the backend URL
  instead.

## security-qa — surface checks

1. Dependency audit: Gradle dependency verification /
   OWASP dependency-check plugin / `gradle dependencyUpdates` for known
   CVEs, per what the project has available.
2. Manifest review: exported activities/services/receivers that shouldn't
   be; `android:debuggable` in release config; `usesCleartextTraffic`;
   over-broad permissions vs. what the app actually does.
3. Secrets hygiene: hardcoded API keys in source, `local.properties` or
   keystores committed, secrets baked into the APK (strings/resources).
   Reference file/line, never print values.
4. Network security config: cleartext allowed where it shouldn't be,
   missing certificate pinning only if the threat model calls for it.
5. Backup/export: `allowBackup` implications for sensitive data, given the
   threat model.
6. Documented default credentials still active (no brute-forcing).

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
