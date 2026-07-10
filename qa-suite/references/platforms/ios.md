# Platform: iOS

Checklists for iOS apps. Assumes Simulator or an explicitly-scoped test
device. Analogous to `android.md` — where a check isn't listed here, adapt
the Android equivalent to the iOS toolchain and say you did so.

## smoke-qa — startup checks

- Build succeeds (`xcodebuild` / project scheme); Simulator install and
  launch succeed.
- App reaches its first screen without crash; no crash logs in the launch
  window (Console / `xcrun simctl spawn booted log`).
- One representative action per core flow.

## bob-qa — accessibility checklist (iOS)

| Check | Standard |
|---|---|
| VoiceOver navigation | Every interactive element reachable with a meaningful accessibility label |
| Touch target size | ≥44×44pt (Apple HIG) |
| Text contrast | ≥4.5:1 normal, ≥3:1 large text |
| Dynamic Type | Layout survives largest accessibility text sizes without clipping |
| Focus order | Logical VoiceOver traversal |
| State announcement | Custom controls announce state via accessibility traits/values |

Automated assist: Accessibility Inspector (Xcode). Supplements manual
VoiceOver passes.

## bob-qa — visual weirdness sweep

Design oracle: the project's own design tokens/docs when defined, otherwise
Apple Human Interface Guidelines. Evidence per finding: screenshot.

Use project design docs, design tokens, and acceptance criteria first. Use
these platform checks only when project-specific visual oracles do not
answer the question. Cite the stable ID for matched checks; otherwise report
the visible symptom plainly without inventing a standard.

| ID | Check |
|---|---|
| VW-IOS-01 | Tappable controls ≥44×44pt (HIG) |
| VW-IOS-02 | Text truncation, overlap, or clipping at default Dynamic Type size |
| VW-IOS-03 | Layout survives largest accessibility Dynamic Type sizes without clipping, overlap, or lost controls |
| VW-IOS-04 | Keyboard does not occlude the focused input; content scrolls or resizes |
| VW-IOS-05 | Content respects safe areas: nothing hidden behind the notch/Dynamic Island, status bar, or home indicator |
| VW-IOS-06 | Spacing/alignment consistency: same component type rendered with consistent padding, size, and style across screens; standard layout margins respected |
| VW-IOS-07 | Dark Mode: all text and controls readable and visible; no invisible-on-background elements |
| VW-IOS-08 | Rotation (if supported): layout reflows without breakage or state loss |
| VW-IOS-09 | Images/icons: no stretching, squashing, or visible low-resolution scaling |
| VW-IOS-10 | Empty, loading, and error states render intentionally — not blank or broken screens |
| VW-IOS-11 | Long-string overflow: fields and labels tested with a realistic 3x-length string wrap or truncate gracefully |
| VW-IOS-12 | Text contrast ≥4.5:1 (≥3:1 large text); non-text UI element contrast ≥3:1 |

## performance-qa — metrics

- **PERF-IOS-01 Launch time** via Xcode Organizer / `xctrace` or XCTest launch performance
  tests.
- **PERF-IOS-02 Hitches/frame drops** during core flows (Instruments:
  Animation Hitches).
- **PERF-IOS-03 Memory** via Instruments across a flow; trend vs. plateau.
- **PERF-IOS-04 App size** vs. prior baseline if release builds are in scope.

No-baseline defaults: no watchdog terminations during tested flows.
Hitch-free scrolling is a finding only when reported by Instruments or
MetricKit; do not invent numeric hitch thresholds. Project baselines
override these defaults once present.

## security-qa — surface checks

These checks are security hygiene, not a pentest. MASVS references are
OWASP MASVS v2.1.0 control groups, not compliance claims.

| ID | Check | MASVS v2.1.0 category |
|---|---|---|
| SEC-IOS-01 | Dependency audit per package manager (SwiftPM/CocoaPods advisories); cite only actual tool output for CVE, severity, affected version, or CWE. | MASVS-CODE: Code Quality |
| SEC-IOS-02 | Info.plist review: ATS exceptions (`NSAllowsArbitraryLoads`), over-broad usage descriptions, URL schemes that expose actions. | MASVS-NETWORK: Network Communication; MASVS-PLATFORM: Platform Interaction; MASVS-PRIVACY: Privacy |
| SEC-IOS-03 | Secrets hygiene: hardcoded keys in source or bundled plists; keys recoverable from the built app. Reference file/line, never print values. | MASVS-STORAGE: Storage; MASVS-CRYPTO: Cryptography; MASVS-AUTH: Authentication and Authorization |
| SEC-IOS-04 | Keychain vs. UserDefaults for sensitive storage, per threat model. | MASVS-STORAGE: Storage |
| SEC-IOS-05 | Documented default credentials still active (no brute-forcing). | MASVS-AUTH: Authentication and Authorization |

## compatibility-qa — matrix

**Axis 1 — OS versions:** minimum deployment target, latest, one between.
**Axis 2 — devices:** smallest supported iPhone, largest, iPad if
supported; portrait + landscape if rotation is supported.

Same two-pass method as other platforms; Simulator coverage is labeled
**simulated**, real-device coverage claimed only when actually used.
