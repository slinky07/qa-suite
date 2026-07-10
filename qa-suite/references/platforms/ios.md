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

Use project design docs, design tokens, and acceptance criteria first. Use
these platform checks only when project-specific visual oracles do not
answer the question. Cite the stable ID for matched checks; otherwise report
the visible symptom plainly without inventing a standard.

| ID | Check |
|---|---|
| VIS-IOS-01 | Device classes: core screens avoid overlap, clipping, and unreachable controls on supported iPhone and iPad sizes |
| VIS-IOS-02 | Dynamic Type: largest supported text sizes do not hide primary actions or critical content |
| VIS-IOS-03 | Safe areas and system UI: notches, home indicator, tab bars, navigation bars, sheets, and keyboard do not cover app controls |
| VIS-IOS-04 | iOS states: highlighted, focused, disabled, selected, loading, empty, and error states are visually distinct and design-system consistent |
| VIS-IOS-05 | Lists and scrolling: navigation titles, sticky controls, bottom bars, and virtualized content do not jump, duplicate, or obscure selected items |
| VIS-IOS-06 | Assets and motion: icons, images, maps, charts, and animations render sharp, at the intended aspect ratio, and without unintended flicker |

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
