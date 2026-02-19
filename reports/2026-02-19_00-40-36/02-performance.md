Now I have a comprehensive view of the entire codebase. Let me compile the full performance review.

---

# Performance Review

## Summary

Shadow Speaking is a well-structured Cloudflare Workers + React Router 7 application with solid use of D1 batch operations and KV for sessions. The most significant issues are sequential hot-path DB writes in `handlePracticeComplete`, unbounded cron fan-out that grows linearly with users, sequential TTS generation during preprocessing, and a missing `Cache-Control` range-request header for audio streaming.

---

## Issues Found

### [HIGH] Sequential DB writes on the hot practice-complete path

- **File**: `server/api/practice.ts:18–56`
- **Issue**: `handlePracticeComplete` executes 4–5 separate DB round-trips in series: INSERT practice_record → UPDATE plan_items → UPDATE daily_plans (subquery) → SELECT material → UPDATE material → SELECT user → UPDATE users. Every practice completion blocks on each query serially.
- **Impact**: On D1 (which has ~4–10 ms per round-trip in the same region), 6 sequential queries add ~30–60 ms of latency per completion. This is the single most frequently triggered write path.
- **Fix**: Combine into a `db.batch()` where operations don't depend on each other's results. The `updateMaterialAfterPractice` SELECT + UPDATE and the streak SELECT + UPDATE can be pre-computed client-side or merged. At minimum, the plan_item UPDATE, daily_plans counter UPDATE, and user streak UPDATE can be batched after the record insert.

---

### [HIGH] N+1 queries in cron: one `generateDailyPlan` call per user

- **File**: `server/cron/daily-plan.ts:19–35`
- **Issue**: The cron handler fetches all users in a single query, then calls `generateDailyPlan(env.DB, user, planDate)` in a sequential `for` loop for each user. Each `generateDailyPlan` call executes 3–4 queries (check existing plan, fetch review materials, fetch new materials, batch insert). With N users this is O(N) D1 round-trips.
- **Impact**: With 100 users: ~400 D1 queries executed sequentially in one cron invocation, potentially timing out the Worker's 30-second CPU limit. Cloudflare cron Workers have a 15-minute wall-clock but ~30 s CPU time limit per invocation.
- **Fix**: Process users concurrently with `Promise.all` (with a concurrency limit, e.g. `p-limit` or manual batching of 10 at a time). Also consider pre-fetching all review materials across users in a single `WHERE user_id IN (...)` query.

---

### [HIGH] TTS generated sequentially for 3 speeds per material

- **File**: `server/services/minimax.ts:222–228`
- **Issue**: The `preprocessMaterial` pipeline generates slow/normal/fast audio with a `for` loop — each `generateTTS` call awaits the previous before starting the next.
- **Impact**: Each TTS call to `api.minimax.io` takes 1–3 s. Three sequential calls = 3–9 s of wall-clock time per sentence. When a user adds a paragraph (e.g. 10 sentences), preprocessing runs sequentially in `waitUntil`, so a single sentence takes 3–9 s longer than necessary.
- **Fix**: Run the three TTS calls concurrently with `Promise.all`:
  ```ts
  const results = await Promise.all(speeds.map(({ speed }) => generateTTS(apiKey, sentence, speed)));
  ```

---

### [HIGH] Preprocessing materials sequentially in `waitUntil`

- **File**: `app/routes/_app.input.tsx:59–75`
- **Issue**: The `waitUntil` block iterates sentences in a `for` loop and `await`s each `preprocessMaterial` call. Each preprocessing involves 1 LLM call (~1–3 s) + 3 TTS calls (~3–9 s) + 4 D1 queries. Adding 10 sentences = 40–120 s of sequential work in a single Worker invocation.
- **Impact**: Worker `waitUntil` has no guaranteed completion time. With large batches, preprocessing may be killed mid-way by the Worker runtime, leaving many materials stuck in `pending` state indefinitely.
- **Fix**: Trigger a separate queue (Cloudflare Queues) or use a cron-based retry loop to process `preprocess_status = 'pending'` materials. This decouples input submission from preprocessing and allows retries with backoff.

---

### [MEDIUM] Double `getTodayPlan` query when plan doesn't exist

- **File**: `app/routes/_app.today.tsx:20–28`
- **Issue**: When no plan exists, the loader calls `getTodayPlan` (2 queries: one for plan, one for items), then `generateDailyPlan` (3–4 queries), then calls `getTodayPlan` again (2 more queries) to re-fetch the newly created plan.
- **Impact**: Adds 2 unnecessary D1 queries (~10–20 ms) on first-visit of the day for every user.
- **Fix**: `generateDailyPlan` already returns `{ planId, totalItems }`. Use the `planId` to fetch items with a single query instead of re-calling `getTodayPlan`.

---

### [MEDIUM] Redundant ownership validation queries in practice action

- **File**: `app/routes/_app.today.$planItemId.tsx:50–71`
- **Issue**: The action performs two separate ownership-checking queries (SELECT material WHERE user_id = ?, then SELECT plan_item JOIN daily_plans WHERE user_id = ?) before calling `handlePracticeComplete`, which then does its own queries. The loader already verified ownership via a JOIN — the action is rechecking the same invariants.
- **Impact**: Adds 2 extra D1 round-trips (~10–20 ms) on every practice completion submission.
- **Fix**: Combine into a single JOIN query that validates both material and plan_item ownership at once, or trust the session-based ownership check from the loader and skip the re-validation.

---

### [MEDIUM] Audio served without streaming / range-request support

- **File**: `app/routes/api.audio.tsx:19–28`
- **Issue**: `env.R2.get(key)` returns the full object and passes `object.body` directly as a `Response`. There is no `Range` header handling. The browser's `<audio>` element relies on HTTP range requests to seek and to start playback before the file is fully downloaded.
- **Impact**: Without range request support, browsers cannot seek within audio files, and may stall while waiting for the entire file to download before beginning playback. For a 0.75× TTS MP3 (typically 200–600 KB), this adds 200–800 ms to time-to-first-audio on slow connections.
- **Fix**: Forward the `Range` header to R2 using `env.R2.get(key, { range: request.headers.get("Range") })` and return a `206 Partial Content` response with `Content-Range` when a range is requested. Also add `Accept-Ranges: bytes` to all audio responses.

---

### [MEDIUM] `getUserMaterials` runs two sequential COUNT + SELECT queries

- **File**: `server/db/queries.ts:86–101`
- **Issue**: `getUserMaterials` fires a `COUNT(*)` query and then a `SELECT *` query sequentially with the same WHERE clause. These could be batched.
- **Impact**: ~2× D1 round-trips for every corpus page load (~10 ms added latency).
- **Fix**: Use `db.batch()` to run count and data queries in parallel. Alternatively, use a single query with `COUNT(*) OVER()` window function if D1 SQLite supports it.

---

### [MEDIUM] `getUserMaterialStats` runs two sequential GROUP BY queries

- **File**: `server/db/queries.ts:359–371`
- **Issue**: `getUserMaterialStats` (called on the profile page loader) fires a `GROUP BY status` query and a `GROUP BY level, status` query sequentially.
- **Impact**: 2 sequential D1 round-trips that could be parallelized, adding ~10 ms latency to profile page loads.
- **Fix**: Wrap with `db.batch([statusQuery, levelQuery])` and destructure results.

---

### [MEDIUM] `silenceDetection` calls `setVoiceRatio` on every 100ms interval tick

- **File**: `app/hooks/useSilenceDetection.ts:70–74`
- **Issue**: `setVoiceRatio(ratio)` is called unconditionally every 100ms during recording. This triggers a React re-render 10×/second for as long as the user is recording, even when the ratio is stable.
- **Impact**: 10 unnecessary React re-renders per second during recording, potentially causing frame drops on low-end mobile devices (the primary target platform).
- **Fix**: Only call `setVoiceRatio` when the value changes by more than a threshold (e.g. `Math.abs(ratio - prev) > 0.01`), or throttle using `requestAnimationFrame` instead of `setInterval`.

---

### [MEDIUM] `OpenAI` client instantiated on every LLM call

- **File**: `server/services/minimax.ts:91–95`
- **Issue**: `new OpenAI({ apiKey, baseURL })` is created inside `analyzeSentence`, which is called once per sentence during preprocessing. In a Worker environment with module-level globals, this is unnecessary object allocation on each call.
- **Impact**: Minor allocation cost per call, but the SDK constructor also sets up internal state and HTTP clients that could be reused.
- **Fix**: Hoist the client creation to module scope (passing `apiKey` at initialization time via an environment singleton), or accept the client as a parameter to allow reuse across multiple sentences in a preprocessing batch.

---

### [LOW] Audio cache headers too short for static TTS files

- **File**: `app/routes/api.audio.tsx:27`
- **Issue**: TTS audio files use `Cache-Control: private, max-age=3600` (1 hour). These files are immutable — once generated for a material, they never change. The R2 key includes the `materialId` which is a UUID.
- **Impact**: After 1 hour, every audio play re-fetches from R2, wasting egress bandwidth and adding 50–200 ms of latency per audio load.
- **Fix**: For TTS files (path starts with `audio/`), use `Cache-Control: private, max-age=86400, immutable`. For user recordings (path starts with `recordings/`), keep the current 1-hour TTL or make it shorter.

---

### [LOW] `uuid` package used alongside `crypto.randomUUID()`

- **File**: `server/api/practice.ts:18`, `server/api/recordings.ts:24`, multiple files
- **Issue**: `practice.ts` uses `crypto.randomUUID()` (native), while `recordings.ts`, `queries.ts`, `cold-start.ts`, and `plan-generator.ts` import `uuid` (v4 as uuidv4). Two mechanisms are used for the same purpose.
- **Impact**: The `uuid` npm package adds ~7 KB to the bundle (minified). `crypto.randomUUID()` is available in all modern runtimes including Cloudflare Workers, Browsers, and Node ≥ 14.17.
- **Fix**: Remove the `uuid` dependency entirely and replace all `uuidv4()` calls with `crypto.randomUUID()`.

---

### [LOW] Content LIKE search without index

- **File**: `server/db/queries.ts:80–83`
- **Issue**: The corpus search uses `content LIKE '%query%'` which requires a full table scan (leading wildcard prevents index use). With no full-text index defined on `materials.content`, this degrades with corpus size.
- **Impact**: Acceptable at small scale (<1000 rows per user), but corpus search will slow noticeably as users accumulate materials. No user-visible impact today.
- **Fix**: Add an FTS5 virtual table for `materials.content` in the D1 schema, or document the current limitation. SQLite FTS5 is supported by D1.

---

### [LOW] `updateProgress` `useCallback` closure captures `isPlaying` state, causing stale re-creation

- **File**: `app/hooks/useAudioPlayer.ts:15–22`
- **Issue**: `updateProgress` is a `useCallback` with `[isPlaying]` in its dependency array. Every time `isPlaying` changes, a new `updateProgress` function is created, and `play` (which depends on `updateProgress`) is also recreated. This means any parent component holding a reference to `play` will see a new reference on every play/pause toggle.
- **Impact**: Potential unnecessary re-renders in parent components if `play` is passed as a prop; the `requestAnimationFrame` loop references the latest closure which is generally fine but the re-creation on every toggle is unnecessary.
- **Fix**: Use `useRef` for `isPlaying` within the `rAF` loop instead of closing over state, or restructure the RAF loop to read from the ref rather than the closure.

---

## Positive Findings

- **D1 batch operations used correctly**: `cold-start.ts`, `plan-generator.ts`, `preprocessor.ts`, and `plan-generator.ts` (regenerate) all use `db.batch()` to avoid N+1 patterns for bulk inserts and duplicate checks. This is well-executed.
- **KV session with write-amplification reduction**: `auth.ts:91–99` only renews the session TTL when less than half remains — a thoughtful optimization that halves KV write traffic.
- **Login rate limiting via KV**: Brute-force protection is implemented with per-username lockout, and uses KV TTL for automatic expiry — no cron cleanup needed.
- **PBKDF2 with timing-safe comparison**: Password hashing uses 100,000 iterations of PBKDF2-SHA256 and the `timingSafeEqual` comparison, correctly defending against timing attacks.
- **`waitUntil` for async preprocessing**: Returning the HTTP response immediately and using `ctx.waitUntil` for preprocessing is the correct Cloudflare Workers pattern.
- **Correct audio MIME type detection**: The recorder correctly falls back through `audio/webm;codecs=opus` → `audio/webm` → `audio/mp4`, handling cross-browser compatibility properly.
- **Ownership checks via JOIN**: The practice detail loader uses a 3-table JOIN (plan_items + materials + daily_plans) to verify ownership in a single query rather than multiple round-trips.
- **Paginated corpus loading**: `getUserMaterials` implements pagination with configurable limit/offset rather than loading all user materials.
- **AudioContext cleanup**: `useSilenceDetection` properly closes the `AudioContext` and clears the interval in both `stopMonitoring` and the `useEffect` cleanup, preventing resource leaks.
- **Object URL revocation**: `useAudioRecorder.clearRecording` calls `URL.revokeObjectURL` to free memory-backed blob URLs.
