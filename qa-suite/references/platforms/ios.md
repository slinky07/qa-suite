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

## performance-qa — metrics

- Launch time via Xcode Organizer / `xctrace` or XCTest launch performance
  tests.
- Hitches/frame drops during core flows (Instruments: Animation Hitches).
- Memory via Instruments across a flow; trend vs. plateau.
- App size vs. prior baseline if release builds are in scope.

## security-qa — surface checks

1. Dependency audit per package manager (SwiftPM/CocoaPods advisories).
2. Info.plist review: ATS exceptions (`NSAllowsArbitraryLoads`), over-broad
   usage descriptions, URL schemes that expose actions.
3. Secrets hygiene: hardcoded keys in source or bundled plists; keys
   recoverable from the built app. Reference file/line, never print values.
4. Keychain vs. UserDefaults for sensitive storage, per threat model.
5. Documented default credentials still active.

## compatibility-qa — matrix

**Axis 1 — OS versions:** minimum deployment target, latest, one between.
**Axis 2 — devices:** smallest supported iPhone, largest, iPad if
supported; portrait + landscape if rotation is supported.

Same two-pass method as other platforms; Simulator coverage is labeled
**simulated**, real-device coverage claimed only when actually used.
