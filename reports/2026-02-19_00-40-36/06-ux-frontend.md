I now have a thorough understanding of the entire codebase. Here is the structured review report:

---

# UX / Frontend Review

## Summary

Shadow Speaking is a well-structured mobile-first PWA with clean component architecture and thoughtful UX flows. The core practice stages are logically sequenced and the empty states are handled gracefully. However, several gaps in accessibility, audio error handling, and MediaRecorder support detection could block or frustrate users, particularly on iOS and non-Chromium browsers.

---

## Issues Found

### [CRITICAL] No MediaRecorder / getUserMedia support detection or fallback UI

- **File**: `app/hooks/useAudioRecorder.ts:26` and `app/components/audio/AudioRecorder.tsx:9`
- **Issue**: `startRecording()` calls `navigator.mediaDevices.getUserMedia()` directly. If it fails (permission denied, HTTPS not available, unsupported browser), the error is caught and re-thrown, but the `AudioRecorder` component has no error state — it just silently fails. The user sees nothing wrong; the record button simply does nothing on subsequent interaction.
- **Impact**: On iOS Safari < 14.3, MediaRecorder is not supported at all. On any browser without mic permissions, the entire practice flow stalls invisibly at stages 3–6.
- **Fix**: Check `navigator.mediaDevices && window.MediaRecorder` on mount, surface a clear "此浏览器不支持录音" message with a fallback CTA. Catch the rejection from `startRecording()` in the component and show an inline error (e.g., "麦克风权限被拒绝，请在浏览器设置中允许").

---

### [CRITICAL] Silence detection `AudioContext` leaks in `useSilenceDetection`

- **File**: `app/hooks/useSilenceDetection.ts:29-75`
- **Issue**: `startMonitoring()` creates a new `AudioContext` each time it is called, but never closes the previous one before creating a new one. If the user navigates away mid-stage or unmounts the component without calling `stopMonitoring()`, the `AudioContext` and `setInterval` remain active.
- **Impact**: Audio context leak accumulates over repeated practices — browsers impose a limit (usually 6–10 active AudioContexts) and will suspend new ones silently, breaking silence detection and potentially battery-draining the device.
- **Fix**: In `startMonitoring()`, close any existing `audioContextRef.current` before creating a new one. The cleanup in `useEffect` (lines 110–115) is correct but only covers unmount; the re-entrant case is unguarded.

---

### [HIGH] `AudioPlayer` missing cleanup of previous `Audio` instance on `src` change

- **File**: `app/hooks/useAudioPlayer.ts:36-63`
- **Issue**: In `load()`, when a new src is loaded, the previous `HTMLAudioElement`'s event listeners (`loadedmetadata`, `ended`, `error`) are never removed. A new `Audio` object is created and assigned to `audioRef.current`, but the old one stays referenced by the closures in those event handlers and keeps firing.
- **Impact**: If the user replays audio or navigates between practice stages rapidly, stale `ended` callbacks will fire after the component has moved to the next stage, potentially advancing stage state incorrectly or calling `options.onEnded` twice.
- **Fix**: Before creating the new `Audio` instance in `load()`, remove all listeners from `audioRef.current` (or call `audioRef.current.src = ''` to abort) before replacing the ref.

---

### [HIGH] Record button has no `aria-label`; icon-only interactive control

- **File**: `app/components/audio/AudioRecorder.tsx:29-47`
- **Issue**: The record/stop button is a 64×64px circle with only SVG icons and no accessible label. Screen readers announce it as an unlabeled button. The only textual hint is a `<p>` tag below which is not associated with the button.
- **Impact**: Visually-impaired users using screen readers cannot identify or understand the purpose of the primary recording action.
- **Fix**: Add `aria-label={recorder.isRecording ? "停止录音" : "开始录音"}` to the button element.

---

### [HIGH] Audio play button in `AudioPlayer` has no `aria-label`

- **File**: `app/components/audio/AudioPlayer.tsx:39-52`
- **Issue**: Same issue — the play/pause button is icon-only with no accessible name.
- **Impact**: Screen readers cannot identify play/pause controls throughout all practice stages.
- **Fix**: Add `aria-label={player.isPlaying ? "暂停" : "播放"}` to the button.

---

### [HIGH] Bottom navigation tab items lack `aria-current` for active state

- **File**: `app/routes/_app.tsx:62-79`
- **Issue**: Active tab is communicated via color alone (`text-blue-600`). No `aria-current="page"` is set on the active `<Link>`.
- **Impact**: Screen reader users cannot determine which section is currently active.
- **Fix**: Add `aria-current={isActive ? "page" : undefined}` to each `<Link>` in the tab bar.

---

### [HIGH] `StageShadowing` silence detection is stubbed out

- **File**: `app/components/practice/StageShadowing.tsx:92-101`
- **Issue**: The comment on lines 98–101 reads `// This would normally come from silence detection`. The `onLongSilence` prop is accepted by the component and wired from `PracticeFlow`, but it is never actually called. The `useSilenceDetection` hook is not used in this component.
- **Impact**: The "retry" prompt for long silence (declared at lines 170–197) is dead code — `showRetryPrompt` is never set to `true`. Users who struggle and stay silent are never offered to go back to round 2 as the design intends.
- **Fix**: Integrate `useSilenceDetection` into the `AudioRecorder` flow in `StageShadowing`, or alternatively call `onLongSilence()` when silence is detected after recording completes.

---

### [HIGH] `window.confirm()` for delete confirmation is blocked by some mobile browsers

- **File**: `app/routes/_app.corpus.$id.tsx:202-206`
- **Issue**: Uses `window.confirm()` as a delete guard. Many mobile browsers (Chrome on Android, some iOS webviews) suppress `confirm()` dialogs inside `onClick` handlers, causing the delete to proceed silently.
- **Impact**: Users may accidentally delete corpus entries with no way to recover them.
- **Fix**: Replace with an inline confirmation modal/dialog (similar to the exit confirmation in `PracticeFlow.tsx:176-198` which already does this correctly).

---

### [MEDIUM] `useEffect` in `AudioPlayer` has a missing dependency (`player.load`, `player.play`)

- **File**: `app/components/audio/AudioPlayer.tsx:15-23`
- **Issue**: The `useEffect` only declares `[src]` as a dependency but calls `player.load` and `player.play` which are stable callbacks but not declared. More importantly, `autoPlay` is not in the dependency array — if `autoPlay` changes from `false` to `true`, the effect won't re-run.
- **Impact**: Minor: `autoPlay` behavioral changes won't be reflected without a `src` change. Could cause subtle bugs in practice stages where autoplay state differs across rounds.
- **Fix**: Add `autoPlay`, `player.load`, and `player.play` to the dependency array, or wrap the logic with a `useCallback` that correctly captures all dependencies.

---

### [MEDIUM] Practice page (`_app.today.$planItemId.tsx`) renders `PracticeFlow` inside the `_app.tsx` layout (with bottom nav + padding), then `PracticeFlow` sets its own `min-h-screen`

- **File**: `app/routes/_app.today.$planItemId.tsx:133` and `app/routes/_app.tsx:53-57`
- **Issue**: `_app.tsx` wraps all child routes in `<main className="max-w-lg mx-auto px-4 py-6">` and adds `pb-20` for the bottom nav. `PracticeFlow` itself also sets `min-h-screen` and has its own sticky header. The result is that the practice view is incorrectly contained inside a padded `main` element with an unwanted bottom nav visible during a full-screen practice session.
- **Impact**: On small screens (~375px wide), the bottom nav appears on top of practice UI action buttons, obscuring "Next stage" and recording controls.
- **Fix**: The practice route should either (a) be moved outside the `_app` layout, or (b) the `_app` layout should detect the practice route and suppress the bottom nav (e.g., via an outlet context flag).

---

### [MEDIUM] `AudioPlayer` progress bar is not interactive (no seek support on mobile)

- **File**: `app/components/audio/AudioPlayer.tsx:54-65`
- **Issue**: The progress bar is a visual-only `div`. Users cannot tap/drag to seek. The `useAudioPlayer` hook exposes a `seek()` function but it is never connected to any UI.
- **Impact**: Users listening to long sentences cannot jump to a specific part to practice a difficult segment.
- **Fix**: Convert the progress bar to a `<input type="range">` or add a `onClick` / `onPointerMove` handler that calls `player.seek()`.

---

### [MEDIUM] Onboarding step advancement depends on `actionData` comparison, which can get stuck

- **File**: `app/routes/onboarding.tsx:83-93`
- **Issue**: Step advancement uses `useEffect` comparing `actionData.step === "level" && currentStep === 2`. If the user re-submits the same step (e.g., double-taps), `actionData` doesn't change, so the effect doesn't re-fire and the step never advances.
- **Impact**: Users who experience network delays and double-submit may get stuck on a step with no feedback.
- **Fix**: Use a different state key (e.g., a counter `actionData.version`) or simply advance on the first successful `actionData` regardless of step guard, since the server already validates sequencing.

---

### [MEDIUM] `_app.corpus.tsx` filter buttons have no touch target padding for level filters

- **File**: `app/routes/_app.corpus.tsx:140-151`
- **Issue**: Level filter buttons (`L1`–`L5`) are rendered as `px-3 py-1.5 text-xs` chips. At ~28×24px, they fall below the 44×44px minimum recommended touch target size.
- **Impact**: Users on mobile with larger fingers may mis-tap adjacent filters or fail to hit the target.
- **Fix**: Increase padding to at least `px-4 py-2.5` or wrap with a larger invisible tap area using `min-h-[44px]` and `min-w-[44px]`.

---

### [MEDIUM] No loading skeleton / placeholder while practice items show "处理中..."

- **File**: `app/routes/_app.today.tsx:194-196`
- **Issue**: Items in `preprocess_status === "pending"` display a small grey "处理中..." text, but the "开始" button is simply absent (not shown). The item card looks inert with no visual indication of when it will be ready.
- **Impact**: New users who just added material and return to Today see a list of cards with no actionable button and no indication of progress, leading to confusion about whether anything is happening.
- **Fix**: Add a pulsing skeleton or spinner within the card area where the "开始" button would appear. Consider adding a note like "通常需要 30 秒" to set expectations.

---

### [MEDIUM] `confirm()` inside a React event handler is an anti-pattern — also missing `aria` dialog role

- **File**: `app/routes/_app.corpus.$id.tsx:202-206`
- **Issue** (additional): Beyond the mobile suppression issue noted above, using `e.preventDefault()` inside `onClick` to block a `<Form>` submit that is inside a button is fragile — React synthetic events and native events have different bubbling behaviors.
- **Fix**: Same as the [HIGH] fix above — use a controlled modal with proper `role="dialog"` and focus management.

---

### [LOW] `StageShadowing` wave animation uses `Math.random()` on each render

- **File**: `app/components/practice/StageShadowing.tsx:138-148`
- **Issue**: The round-3 "no text" wave animation uses `Math.random() * 20` inline in JSX, which generates a new height on every render pass.
- **Impact**: In React Strict Mode (development), this double-renders and causes visual jitter. In production it causes the bars to flicker on any state update.
- **Fix**: Pre-compute the random heights once in a `useMemo` or define them as constants.

---

### [LOW] `AudioRecorder` component ignores the `onSilentDetected` prop it declares

- **File**: `app/components/audio/AudioRecorder.tsx:5,12`
- **Issue**: `onSilentDetected` is declared in the interface but destructured as unused (not in the destructure at line 12).
- **Impact**: Dead interface — creates a false expectation that silence detection is active in the recorder component.
- **Fix**: Either remove the prop from the interface, or implement it using `useSilenceDetection`.

---

### [LOW] `input` page `<textarea>` clears on navigation away — no draft persistence

- **File**: `app/routes/_app.input.tsx:101-106`
- **Issue**: The textarea has no `defaultValue` derived from session storage. If a user types a long text, switches tabs, and returns, the content is lost.
- **Impact**: Minor data loss frustration for users who type longer texts.
- **Fix**: Persist draft text to `sessionStorage` via a debounced `onChange` handler and restore it as `defaultValue`.

---

### [LOW] Profile calendar uses client-side `new Date()` which may differ from server's UTC+8 "today"

- **File**: `app/routes/_app.profile.tsx:173-180`
- **Issue**: The calendar renders 30 days using the browser's local `Date`, but `practice_records` are stored with a UTC timestamp. The server checks `date('now', '-30 days')` which is in UTC. A user in UTC+8 practicing after midnight UTC (08:00–00:00 China time) will see a mismatch between which day shows as "today" on the calendar vs. what the server considers today.
- **Impact**: Minor visual discrepancy — today's practice may appear on yesterday's cell.
- **Fix**: Derive the "today" string on the server and pass it down to the component, or apply the +8h offset consistently in the client calendar rendering.

---

## Positive Findings

- **Excellent empty states**: All four key empty states (no plan, no corpus, all done today, corpus empty) are implemented with clear iconography, contextual copy, and actionable CTAs — this is done right.
- **Proper form accessibility**: All form inputs (`login`, `register`, `settings`) have associated `<label>` elements with matching `htmlFor`/`id` pairs and correct `autoComplete` attributes.
- **Good `disabled` states during submission**: Every form's submit button uses `navigation.state === "submitting"` to prevent double-submission — consistently applied across all routes.
- **Viewport and safe area**: `root.tsx` correctly includes `viewport-fit=cover` and `app.css` defines `.safe-area-pb` using `env(safe-area-inset-bottom)`. The bottom nav applies this class.
- **Proper `<audio>` cleanup**: `useAudioPlayer` has a `useEffect` cleanup that cancels the animation frame and pauses audio on unmount — good memory hygiene.
- **Audio codec fallback**: `useAudioRecorder` correctly checks MIME type support in order (`audio/webm;codecs=opus` → `audio/webm` → `audio/mp4`) before creating the `MediaRecorder`.
- **Security**: Audio API route validates that `r2_key` is namespaced under the authenticated user's ID before serving — no IDOR vulnerability.
- **Confirmation modal for exit**: `PracticeFlow` implements a proper in-page modal for exit confirmation (not `window.confirm`), with clear copy and reversible default action ("继续练习").
- **Spaced repetition logic is server-side**: No client-side state is trusted for SRS calculations — the server validates ownership of both material and plan item before recording completion.
- **List keys**: All mapped lists consistently use stable IDs as `key` props (`material.id`, `tab.path`, etc.) rather than array indices — except where index is unavoidable (phonetic notes, which have no ID).
