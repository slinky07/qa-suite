# Issue 86 real-engine coverage record

Status date: 2026-08-02

This is the bounded maintainer-side coverage record for
[Issue #86](https://github.com/slinky07/qa-suite/issues/86), residual R5 of
the [user integration campaign](../../docs/exec-plans/completed/user-integration-campaign.md).
The normative evaluation contracts remain in `tests/evaluation/README.md`
and `scripts/evaluation/`. This record does not change the distributed
`qa-suite/` or qualify the evaluator. It does not define a reusable device
lab or add a new evaluation framework.

## Decision

Issue #86 acceptance is met for delivery handoff.

- One reviewed, controller-closed run exercised two actual browser-engine
  families on the same frozen candidate. Chromium `149.0.7827.55` and
  Firefox `151.0` each completed the declared message flow at a 1440x900
  emulated CSS viewport.
- The same closed run completed both declared Chromium targets at 1024x800
  and 375x800. Each passing target reached exact status `Message sent.`,
  restored an enabled primary action, showed no horizontal overflow, and
  retained a screenshot.
- WebKit was attempted once and remained `Blocked` before page identity
  because the installed Playwright package expected revision 2327 while the
  available cache was revision 2311. The process-bound attempt returned
  `Unknown setting: PushAPIEnabled` and was terminated cleanly.
- Safari-product behavior, simulators, physical devices, and touch hardware
  remain explicit gaps. No engine or device result is inferred from viewport
  emulation.

This semantic decision does not make the delivery node `Done`. Focused
checks, the required repository suite, release parity, PR CI, human review,
and merge remain workflow gates.

## Frozen identities

| Boundary | Frozen identity |
|---|---|
| Controller and subject commit | `c4e402f4d04b2f6808040578c38f92f97ce8a368` |
| Repository tree | `ab5a812cecee93c448911c84e16a8d017e4b3d00` |
| Subject `qa-suite/` tree | `6902b67449d0a97a19604549a59f09b46ffe54ae` |
| Evaluation fixtures tree | `a2fd882f7d4739a7a0f8f4c0e08097bf9e3e344f` |
| Case A fixture tree | `b1ad0a08e5f99677779cfe98e0bfbd8995f43b15` |
| Case B fixture tree | `cda2e740744e78585ce3cfced2c03623093460e7` |
| Compatibility suite blob | `d39ae3d3e27a754e638d73cf83e8a155cb13836c` |
| Shared support-matrix blob | `f50e2f91bcdbf298580d98e8b35e5ca2b4809237` |
| Controller program SHA-256 | `6c23be8be2daa675922e181bbd8937232fd198f0193178cc60e0f9b973722b54` |
| Runtime | Node `v26.5.0`; macOS `26.5.2` build `25F84`; `arm64` desktop host |
| Browser driver | Playwright `1.62.0-alpha-1783623505000`; package manifest SHA-256 `7cc410b3783bad3241ad0fa44aef6f2ff254c87f80e7b4963b1c94c1b994d095` |

Each prepared disclosure named one opaque public case and the same subject
commit. No sibling case, sealed oracle, prior report, controller state,
credential, private data, or owner PDF/HTML entered a QA dispatch. No external
provider session was used.

## Evidence-class method

The reviewed matrix treats these dimensions as independent:

- **Engine evidence** requires an actual browser-engine process and a runtime
  version captured after a page is established.
- **Viewport evidence** records the CSS viewport dimensions and whether they
  are native or emulated.
- **Device evidence** records the host, simulator/emulator, or physical-device
  class and its input mode.

An actual engine process with an emulated CSS viewport supports only that
engine-and-viewport combination. It does not establish physical-device
coverage. Playwright WebKit would be WebKit-engine evidence; it would not be
Safari-product, iOS-simulator, or physical-iOS-device evidence. A simulator
would remain simulated evidence and would not establish physical-device
behavior.

## Retained attempts and closures

All semantic observations below are role-neutral. No sealed-role or expected
classification mapping was used.

| Record | Phase | Run | Candidate | Terminal state | Controller disposition |
|---|---|---|---|---|---|
| Case A, dispatch 1 | Smoke identity preflight | `run_7bb8d7feafc6483a200bc7cf1a040019` | `c4e402f4d04b2f6808040578c38f92f97ce8a368` | `Blocked` before target access | Preserved in the later valid closure; the envelope had incorrectly required controller-only fields and smoke-lane equality. |
| Case A, dispatch 2 | Smoke | `run_7bb8d7feafc6483a200bc7cf1a040019` | `c4e402f4d04b2f6808040578c38f92f97ce8a368` | `No-Go`; compatibility gated | Valid closure SHA-256 `d8024002f661bfcf388eb736f862e99afb5244d3fb55d8464fe67abfaffb0f38`; artifact tree `de289fea5701a9f25e425d591309d36755dee769c3b776ed59f1d46d0f185786`. |
| Case B, first preparation | Smoke plus compatibility | `run_0fa9b32fa912f304fb87d1d51648f067` | `c4e402f4d04b2f6808040578c38f92f97ce8a368` | Controller closure `invalid` | A Chrome profile under `QA/` contained three files above the 16 MiB artifact cap. No `closed.json` exists; journal SHA-256 `d49e6be99b7ae194c5d6d0c853efb445bb269feb8823abed8da28f4a16ffe85a`; terminal event SHA-256 `cad31e41253524dfa83d1d1fd55e9aeff5f52386579512db0179b74d5c8e484f`. Its semantic output is not counted. |
| Case B, clean preparation | Smoke | `run_eef8152e5d943139713346c6ba07b73b` | `c4e402f4d04b2f6808040578c38f92f97ce8a368` | `Go with findings (1×S4)` | Both declared targets passed; one missing-favicon console error was retained. |
| Case B, clean preparation | Compatibility | `run_eef8152e5d943139713346c6ba07b73b` | `c4e402f4d04b2f6808040578c38f92f97ce8a368` | `Blocked` on WebKit only | Valid closure SHA-256 `31d5c4d0fbae373ba3b44b05074dcfe6a40816dc25e3cee794249de74e2b6f88`; artifact tree `f379c12a0acad328903e709f53cf2703db46a94a0d5e5fd8ce370e1c859e5be8`. |

The Case A preparation bound input tree SHA-256
`a66906a650ddda07f4cd14b3ed9720958ef59af73e39b5a3be44ce3c55c7647b`.
The invalid Case B preparation bound
`c87a61e9d2dbf4c3cd64076773544dea87ad3ba04dea354d36d90df87a088d84`.
The clean Case B preparation bound
`322dfd53a962e9d536915e0d0413f95b2d3372c78aeea8c81079c56926810204`.

## Smoke-gate results

- Case A passed its 1024x800 declared Chromium target, then remained at
  `Sending...` with the action disabled after 10 seconds at 375x800. The
  `No-Go` correctly prevented deeper compatibility dispatch. The captured
  report SHA-256 is
  `9ff5135887d29374e6255b7a08135ade3d7dbb11053652d9dd549d9bc452d5fc`;
  its pass and blocking screenshots have SHA-256
  `a72033017c4dcf01b142055557bebadf2a2c8b8650b355cf0b7019199dafad33`
  and
  `776d44e3cbd06d1ffca3ddf90dda4b37efc4429d2e7e91f4ce6f6314ce76d6b0`.
- The clean Case B smoke gate passed both declared targets with Chromium
  `149.0.7827.55`. It retained one `S4`, `P2` finding because `/favicon.ico`
  returned 404 and produced one initial-load console error. The main page,
  stylesheet, application module, and both message flows passed. The captured
  smoke report SHA-256 is
  `59dea75e5d4f5698992be133b5f48a4d1e926b4fe77c3d6445f48e6ad3d9873d`.

## Declared matrix

| Target ID | Browser/runtime | Engine family | Device or simulator class | Viewport mode | Input mode | Intended evidence claim |
|---|---|---|---|---|---|---|
| `chromium-1440` | HeadlessChrome `149.0.7827.55` | Chromium | macOS 26.5.2 arm64 desktop host; no simulator or physical device | Emulated CSS `1440x900`; scale 1 | Keyboard and mouse pointer; touch false | Actual Chromium engine at representative desktop width |
| `firefox-1440` | Firefox `151.0` | Firefox | macOS 26.5.2 arm64 desktop host; no simulator or physical device | Emulated CSS `1440x900`; scale 1 | Keyboard and mouse pointer; touch false | Actual Firefox engine at representative desktop width |
| `webkit-1440` | Runtime not established; Playwright expected revision 2327 and cache supplied revision 2311 | WebKit | macOS 26.5.2 arm64 desktop host; no simulator or physical device | Emulated CSS `1440x900` requested | Keyboard and mouse pointer requested; touch false | One bounded attempt to establish WebKit-engine evidence |
| `chromium-1024` | HeadlessChrome `149.0.7827.55` | Chromium | macOS 26.5.2 arm64 desktop host; no simulator or physical device | Declared emulated CSS `1024x800`; scale 1 | Keyboard and mouse pointer; touch false | Actual Chromium engine at declared 1024px width |
| `chromium-375` | HeadlessChrome `149.0.7827.55` | Chromium | macOS 26.5.2 arm64 desktop host; no simulator or physical device | Declared emulated CSS `375x800`; scale 1 | Keyboard and mouse pointer; touch false | Actual Chromium engine at declared 375px width |

## Reviewed target results

The controller reviewed the closed structured result and all four captured
screenshots. Each screenshot visibly shows `Message sent.` and the enabled
`Send message` action without clipping or overlap.

| Target ID | Candidate SHA | State | Observed behavior | Captured evidence anchor | Material limitation |
|---|---|---|---|---|---|
| `chromium-1440` | `c4e402f4d04b2f6808040578c38f92f97ce8a368` | Pass | Exact completion status; reusable action; no overflow; zero console, page, request, or HTTP errors | `QA/compat-eef8152e-chromium-1440.jpg`; SHA-256 `e0dc2641fcc694950effb08a061d4e6308efce4d4de17a7833fd89ec7674238d` | Headless engine plus emulated viewport; not physical-device evidence |
| `firefox-1440` | `c4e402f4d04b2f6808040578c38f92f97ce8a368` | Pass | Exact completion status; reusable action; no overflow; zero console, page, request, or HTTP errors | `QA/compat-eef8152e-firefox-1440.jpg`; SHA-256 `592139b65ef25c2b5d0f6df34eccfad5a815dfd1aa4eefa61a85ad65d6d4cbb9` | Headless engine plus emulated viewport; not Firefox-product UI or physical-device evidence |
| `webkit-1440` | `c4e402f4d04b2f6808040578c38f92f97ce8a368` | Blocked | No page/runtime identity; `Unknown setting: PushAPIEnabled`; process group terminated at 25 seconds | `QA/compat-eef8152e-webkit-blocker.txt`; SHA-256 `32225d9481f4545588445d284d71b3366836b50df1a13f474dcfc3a43d47f454` | No WebKit product-flow result; cache/package revisions differ |
| `chromium-1024` | `c4e402f4d04b2f6808040578c38f92f97ce8a368` | Pass | Exact completion status; reusable action; no overflow; zero console, page, request, or HTTP errors | `QA/compat-eef8152e-chromium-1024.jpg`; SHA-256 `314285c37f43ffc921d7e07f737fc00dd6fb21d848dcd1fb0413b701f5e33c59` | Headless engine plus declared emulated viewport; not physical-device evidence |
| `chromium-375` | `c4e402f4d04b2f6808040578c38f92f97ce8a368` | Pass | Exact completion status; reusable action; no overflow; zero console, page, request, or HTTP errors | `QA/compat-eef8152e-chromium-375.jpg`; SHA-256 `3f0f02454e1b666b2cbf880dc5cce5a23d6ae263931271ebc08a7641a71d40e6` | Headless engine plus declared emulated viewport; not physical-device or touch evidence |

The captured compatibility report SHA-256 is
`57fca5250e754f59ee5ca670be14c97da50708a6faa4307e600e05adc53d1bfa`.
The closed structured result SHA-256 is
`9dc73656a8ec59c8007183e33da6bd80d68b9166329a6ba242a1fff798dda7f6`.

## Coverage gaps

| Gap target | State | Reason or blocker | Claim impact | Unblock condition |
|---|---|---|---|---|
| `webkit-1440` | Blocked | Playwright expected WebKit revision 2327, but cache revision 2311 returned `Unknown setting: PushAPIEnabled` before page identity | No WebKit compatibility conclusion | Provide a WebKit executable compatible with the installed Playwright package and establish a headless page on this host |
| `safari-macos` | Not tested | No authorized Safari-product automation or manual evidence path was in this run | WebKit-engine evidence cannot be labeled Safari-product evidence | Provide an authorized Safari-product target and evidence path |
| `physical-mobile` | Not tested | No authorized physical iPhone, iPad, Android, or other touch device was available | No physical-device compatibility conclusion | Provide an authorized physical device with disposable fixture access |
| `touch-hardware` | Not tested | All completed cells configured touch false and reported zero touch points | No touch-input compatibility conclusion | Provide an authorized touch-capable physical target |
| `mobile-simulator` | Not tested | No configured and authorized mobile simulator was available | No simulated-mobile-device conclusion | Provide a configured simulator and retain the result as simulated evidence |
| `full-cross-product` | Not tested | The bounded matrix varied engine at 1440px and viewport within Chromium only | No claim for every engine at every width | Declare and approve a wider matrix in a separate run |

## Findings and blockers

- Case A retained one core-flow failure at its declared 375px target. It is
  evidence that viewport emulation can expose behavior, not evidence of a
  different engine or a physical device.
- Clean Case B smoke retained the missing-favicon `S4`, `P2` observation. It
  did not affect startup, the message flow, or the deeper matrix. Tracker
  mutation remains separately gated; this node does not silently widen into a
  fixture repair.
- The completed compatibility cells produced no product finding. The WebKit
  result is a tooling blocker with a concrete unblock condition.

## Acceptance reconciliation

| Issue #86 acceptance | Disposition |
|---|---|
| Distinguish viewport emulation from real engine and device evidence | Met by the three independent evidence classes and the explicit non-claims above |
| Exercise a reviewed cross-engine or device matrix, or record a concrete access blocker | Met by closed Chromium and Firefox engine rows; the WebKit blocker is also concrete and bounded |
| Tie every tested target to the frozen candidate | Met; every reviewed target row repeats `c4e402f4d04b2f6808040578c38f92f97ce8a368` |
| Keep missing engines and devices explicit | Met by the coverage-gap table |
| Preserve maintainer evaluation non-qualification | Met by both valid closures and the values below |
| Avoid a broad device lab or new framework | Met; this is one issue-scoped record and focused contract test |

## Preserved non-claims

Both valid controller closures retain:

- `input_integrity: "verified"`
- `artifact_inventory: "closed"`
- `adapter_status: "not-run"`
- `method_order: "unverified_by_report"`
- `context_isolation: "not-attested"`
- `execution_isolation: "not-attested"`
- `fixture_opacity: "not-attested"`
- `network_isolation: "not-attested"`
- `state_authentication: "not-attested"`
- `verification_status: "unverified"`
- `qualification: "not-evidence"`
- `result: null`

The invalid Case B attempt cannot promote any claim. This record is a
maintainer-side reconciliation of controller-captured artifacts plus explicit
orchestrator observations. It does not claim authenticated controller state,
execution isolation, fixture opacity, Safari behavior, physical-device
coverage, release certification, or a qualifying evaluator result.

## Evidence retention

The controller state and lane roots remain retained under `/private/tmp`
until delivery reconciliation. They are execution state, not campaign
authority. This tracked record inlines the material observations, candidate
bindings, closure hashes, artifact hashes, blocker, and limitations; it
becomes durable repository evidence only after commit and merge.

## Verification

Before PR handoff, run:

```sh
node --test tests/evaluation-real-engine-coverage.test.mjs
node --test
node scripts/release/check.mjs --ref HEAD
git diff --check origin/main...HEAD
```

Exact results are recorded in the PR handoff after the candidate commit is
frozen.
