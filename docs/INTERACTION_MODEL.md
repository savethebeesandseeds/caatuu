# Caatuu interaction model

This plan implements the click and gesture audit of 22 September 2026. The
objective is consistent interpretation of deliberate input across the active
browser application and Android WebView. Source implementation and browser
validation are complete; final packaging and boundary checks are recorded below.
Android hardware checks remain separately identified until performed;
publication is not part of this source-change goal.

The six source-work phases below are complete. Coverage includes the launcher,
shared shell, enabled games, declared optional/developer tools and Android asset
delivery. Archived prototypes, separate game experiments and third-party input
implementations are outside this application's interaction contract.

## Contract

Use native HTML buttons, links, forms, selects and `click` activation. Pointer
events are reserved for gestures that require movement. Preserve keyboard and
assistive activation, normal scrolling, pinch zoom, and cancellation before
release. Do not add a global click delay, suppress every repeated activation, or
turn ordinary controls into pointer-down actions.

| Action | Acceptance and repetition |
| --- | --- |
| Open a destination or navigation menu | Repeating the request keeps that destination/menu open. A newer destination supersedes unfinished navigation. Outside dismissal, Escape and Back remain available. |
| Explicit toggle or tile selection | Repeating intentionally reverses the selection. Fast, valid choices must remain responsive. |
| Submit an answer | Accept once for the current attempt. Claim the phase before asynchronous work or synchronous notifications. |
| Advance a round | Button, gesture, keyboard and timer request the same transition. Consume the current round once; never queue extra advances for future rounds. |
| Preference or slider | Show the latest value immediately and keep persistence ordered. |
| Audio | Follow the displayed play/stop/replay meaning. Retire stale playback callbacks on replacement, navigation, cancellation or hiding. |
| Download, install or reset | One operation owns progress and completion; repeated requests cannot create duplicate effects. Preserve confirmation and cancellation. |

Bind accepted work to the current course, view and relevant round/request identity.
When that context changes, cancel or ignore its late callbacks. Disabled visuals
must agree with handler guards. Give immediate pressed/selected feedback and a
visible pending, result or error state when an operation takes time.

Gesture state records the primary contact, start position and current round.
Cancel on second contact, scrolling, pointer cancellation, lost capture, blur,
deactivation, or a changed round. Keep equivalent buttons for swipe and drag
actions. An accepted gesture must not trigger an additional click action.

Use at least 44 CSS pixels for ordinary standalone touch controls, with a larger
coarse-pointer target where it fits. Enlarge the actual control/padding while
preserving compact artwork; avoid overlapping invisible hit areas. Inline text
links and native browser controls require contextual treatment. CSS pixels and
Android dp are not interchangeable device measurements.

## Execution plan

1. **Baseline and ownership.** Confirm canonical `main`, existing container
   mounts, source state and independent file ownership. Preserve concurrent
   work. Record pre-existing test failures separately.
2. **Gesture contract.** Share the useful cancellation behavior between Word
   World and Case Cosmos without changing each game's actions. Cover second
   contacts, changed rounds, controls, edges, scrolling and lifecycle changes.
3. **Action acceptance.** Make navigation open requests idempotent. Review
   answer, Next, timer, drag/drop, form, audio, preference and maintenance
   handlers. Retain existing sound phase/request guards; fix demonstrated gaps
   instead of routing every event through a new global dispatcher.
4. **Targets and feedback.** Normalize undersized shared controls and scroll/zoom
   policies. Check narrow screens, text scales, spacing and focus visibility.
5. **Regression and integration.** Run focused tests for all affected boundaries,
   add cross-input scenarios, integrate assets and cache revisions, verify
   generated browser/Android asset startup, and inspect the served application.
6. **Handoff.** Update this document with surface coverage, results and remaining
   physical-device checks. Verify only `main` refs remain. Report source,
   browser, APK/device and publication status separately.

## Coverage and completion criteria

| Surface | Required evidence |
| --- | --- |
| Startup, Home/setup and course selection | Unready controls cannot accept work; repeat download/cancel/course requests remain coherent. |
| Home/Games/Backpack navigation and Settings/Stats | Repeated open requests are harmless; dismissal, keyboard navigation and focus restoration remain usable. |
| Word World and campaign | One answer/advance per context; cancellation and timer/click ordering are tested. |
| Verb Nebula | Intentional card deselection remains; duplicate match completion and hidden/transition input are rejected. |
| Conjugation Comet | Click/keyboard/wheel preserve phase ownership and cannot queue extra rotations or answers. |
| Grammar Gravity | Noun/adjective answer and Next phases reject duplicates, hidden input and inappropriate shortcuts. |
| Sounds Quasar | Hear-before-answer, one result, playback cancellation and free-space exclusion remain intact. |
| Case Cosmos | Buttons and gestures have equal answer semantics; cancellation, identity and activity checks are covered. |
| Naturalization Nucleus | Click and drag/drop placement cannot double-apply; inactive and modal contexts cannot accept game input. |
| Dictionary, launcher and developer/optional tools | Native activation is retained; async actions claim ownership and typing/composition is respected. |
| Shared controls and Android wrapper | Target sizes, scrolling/zoom and focus remain usable; native Back ownership is preserved. |

All scoped implementation items must have either a fix with regression evidence
or an explicit existing-contract verification. A test failure is not silently
waived; distinguish unrelated content-fixture failures and describe their effect
on coverage. Hardware-only behavior must be listed as unverified rather than
reported as passing.

## Validation matrix

- Tap with slight movement; press then leave the target; release cancellation.
- Vertical/diagonal scrolling, second-contact pinch and pointer cancellation.
- Rapid repeated activation and Next/timer races in both orders.
- Course/view/round replacement, background/resume and stale callbacks.
- Native keyboard Enter/Space, held keys, IME composition and editable controls.
- Nested menus, modal dialogs, iframe boundaries and focus restoration.
- Touch target dimensions at narrow widths and different text scales.
- Existing Android asset packaging/startup and native Back contracts.
- Physical Android touch, edge gestures, TalkBack, stylus and device target sizes
  when a device is available; these are not simulated by handler unit tests.

## Standards used

- [W3C pointer cancellation](https://www.w3.org/WAI/WCAG22/Understanding/pointer-cancellation.html)
- [W3C Pointer Events and touch-action](https://www.w3.org/TR/pointerevents/)
- [W3C target size](https://www.w3.org/TR/WCAG22/#target-size-minimum)
- [Android accessible controls](https://developer.android.com/guide/topics/ui/accessibility/views/apps-views#touch-targets)

## Implementation and evidence

- Baseline: canonical checkout on `main`, HEAD `55f4ed6`, clean at goal start;
  `caatuu-dev` mounts it at `/workspace` and serves the established port 8765.
- Audit baseline: 483/484 tests passed. The English determiner fixture requested
  difficulty 3 although its authored challenges belong to difficulty 1. The test
  now derives the requested focus's authored difficulty; no content or sampling
  policy changed.

| Boundary | Implemented or retained behavior | Regression evidence |
| --- | --- | --- |
| Ordinary activation | Native buttons/forms remain the default; no global debounce or pointer-down activation was added. | Existing controller suites and browser Enter/Space/menu checks |
| Home/Games/Backpack | Repeated open requests retain the menu; outside click, Escape and Android Back close it with appropriate focus. Composing/consumed keys are ignored. | `chrome-ui-behavior.test.mjs` |
| Startup and Home setup | Retained readiness capture/inert barrier and Home download generation ownership. Standalone installer now fences cancelled progress, verification, completion and cleanup from replacement requests. | `app-readiness`, `setup-speech-check`, `home-course-setup`, `course-setup` tests |
| Word World and Case Cosmos | Shared recognizer cancels second contact anywhere, vertical movement/scroll, lost capture, hidden/retired views and changed rounds. It suppresses only the matching gesture click and preserves native controls/keyboard. | `horizontal-gesture`, `case-cosmos-behavior`, `word-world-menu-input`, loading and exposure lifecycle tests |
| Campaign and Next | Retained one transition owner for timer, Next and answer completion; gestures use the same controller entrypoints. | `campaign-verb-reset.test.mjs` and Word World lifecycle tests |
| Verb Nebula | Wrong-answer feedback claims ownership before synchronous learning callbacks. Cancelled timers cannot clear a newer answer; inactive inputs are rejected and intentional deselection remains. | `verb-nebula-language-roles.test.mjs` |
| Grammar Gravity / Conjugation | Kept phase, wheel and result ownership; shortcuts respect editable fields, dialogs, composition and consumed events. | Noun, adjective and conjugation behavior tests |
| Sounds Quasar | Retained hear-before-answer, result claim, free-space exclusions and playback cancellation. | `sound-quasar-behavior.test.mjs` |
| Naturalization | Rejects inactive/menu input, cancels interrupted drags and consumes the drop's trailing click. The same wrong placement cannot record twice during feedback, including callback reentry. | `naturalization-nucleus-shell.test.mjs` |
| Preferences/audio/updates | Retained synchronous preference persistence before notifications, speech/music generation fences and shared update activation promise. | `background-music`, `shared-speech-boundary`, `shared-maintenance-runtime` tests |
| Optional and developer tools | Chat respects composing/held/modified Enter. Audio Lab owns Stop until completion. Image searches reject overlapping submissions and stale hidden-page results; shortcuts respect typing. | `chat-composer-input`, `developer-audio-lab`, `developer-model-tools`, `legacy-embedding-images-input` tests |
| Dictionary and launcher | Native activation retained; launcher generation counters, unavailable-link guards and dictionary provider ownership reviewed. | Dictionary and launcher tests; source review |
| Targets and layout | Shared 44px floor, 48px coarse-pointer rule; actual padding/size rather than overlapping invisible targets. Sliders/Settings retain vertical scroll and pinch zoom. Narrow Word World regions use separate rows; popovers remain above the dictionary card. | CSS contracts, golden historical source/DOM invariants, real browser geometry and hit testing |

### Browser validation

The existing Norwegian tab was inspected at 676×898, 360×800 and 320×760 CSS
pixels. Repeated Home/Games/Backpack activation kept menus open; Escape restored
focus. Native keyboard activation worked. Home display/audio/details targets
measured 44px high. Word World toolbar, speakers, answer choices, report and
Runtime targets measured at least 44px; its navigation targets were 44×52 at
phone width. Audio slider interiors measured about 44.7px after reserving their
container borders. At 320px the display menu stayed inside the viewport and its
controls passed center-point hit testing above the dictionary card. Standard and
Small text retained target sizes and avoided horizontal page overflow. Original
text/viewport settings were restored. No practice answer or update was submitted.

### Physical-device follow-up

The existing container's ADB reported no connected device. Unit fixtures model
event ownership and capture ordering; they do not establish physical browser or
Android gesture arbitration. Before the next APK release, check on a real phone:

1. Small-motion tap, move-off cancellation, vertical scroll and two-finger pinch.
2. Edge Back gestures and Android Back while menus, downloads and games are active.
3. Button/swipe/timer Next races in campaign and standalone play, including
   background/resume during a transition.
4. TalkBack activation and focus order, stylus input, coarse-pointer 48px sizing
   and Android display/font scaling.
5. Naturalization drag/drop ordering and interrupted drags with touch hardware.

These are explicit device checks, not automated passes. No APK was rebuilt or
published for this goal.

### Automated validation

All commands use the existing `caatuu-dev` container at `/workspace`.

| Check | Result |
| --- | --- |
| `node --test apps/language-runtime/tests/*.test.mjs` | 1,242 passed, zero failed |
| Product Home/Word World generated startup, Naturalization and theme contracts | 54 passed, zero failed |
| Android product asset packaging contracts | 20 passed, zero failed; generated asset fixtures only, no APK build |
| Browser setup language choice, setup refresh and course contracts | 78 passed, zero failed |
| Runtime-boundary interaction and APK-plan contracts | 6 passed, zero failed |
| Shared asset registration and five browser-course setup manifests | Refreshed from source; each course includes `horizontal-gesture.mjs` and a new offline cache revision |
| All-course setup manifest `--check` | Passed for all five courses |
| Broad runtime boundary audit, `--skip-apk` | Passed after the authorized audit-maintenance follow-up below |
| Repository structure, Markdown links and diff whitespace | Passed |
| Physical Android interaction | Not run: ADB returned no connected devices |

Detailed TAP and asset-refresh logs are retained under ignored
`artifacts/research/interaction-*`. The setup refresh uses
`node apps/server/tooling/refresh-setup-assets.mjs --all-browser-courses`;
the read-only check adds `--check`. Historical Word World source hashes and
DOM/ARIA contracts remain pinned. Current CSS is checked against target size,
stacking, flow and focus requirements rather than a byte-exact snapshot that
would prohibit the intended ergonomics changes.

### Boundary-audit follow-up

The user authorized resolving the 26 pre-existing assertions after the source
interaction goal. Each was reconciled against current code and history. The
audit now checks usable launcher controls and generated course projections,
follows current module URLs and all-course offline integrity, accepts word-click
formatting without allowing direct sentence generation, and verifies per-course
native dictionaries and actual update-control behavior. Preview checks enforce
the current art-lab gate and continued retirement of the Godot prototype.

This review also found two missing read-only art-lab source mounts in the
documented local `caatuu` Compose service. Those mounts are corrected in source;
the existing `caatuu-dev` server already has the full canonical checkout. No
container was created, recreated or restarted.

The source/HTTP audit with `--skip-apk` passed. The asset/course/audit suites
passed 77 tests, the final focused audit regressions passed 43, and current-source
Rust route tests passed 28. The first two runs overlap by three tests; their
counts must not be added as independent coverage. Mutation fixtures reject
missing modules, stale offline revisions, untrusted dictionary routing, incorrect
update availability, preview promotion and routes escaping the preview gate.

Original failure evidence and the resolution are retained in ignored
`artifacts/research/interaction-boundary-limitations.md`, with the final audit log
in `artifacts/research/interaction-boundary-repaired.log`. This resolves the
source-audit limitation; APK binary inspection and the physical-device checks
above remain separate. At the end of that audit, work was uncommitted in the
canonical checkout, with only `main` and `origin/main` present.
