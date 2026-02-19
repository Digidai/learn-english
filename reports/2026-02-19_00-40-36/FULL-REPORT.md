# Full Code Review Report

**Generated**: 2026-02-19 00:45:41
**Model**: sonnet
**Project**: /Users/dai/Documents/CursorProjects/learn-english

---

## Summary

| Severity | Count |
|----------|-------|
| 🔴 CRITICAL | 9 |
| 🟠 HIGH | 24 |
| 🟡 MEDIUM | 36 |
| 🔵 LOW | 18 |
| **Total** | **87** |

**Review duration**: 5m 5s
**Agents**: 6 launched, 0 failed

---


---

Based on the exploration agent's thorough analysis, here is the structured security review report:

---

# Security Review

## Summary

The Shadow Speaking codebase demonstrates a solid security foundation with strong password hashing, parameterized SQL queries, and well-configured session cookies. The main concerns are a missing file size limit on audio uploads, weak password requirements, and a few authorization gaps in the recording upload flow.

---

## Issues Found

### [MEDIUM] Recording Upload Has No File Size Limit

- **File**: `server/api/recordings.ts`
- **Issue**: The audio recording upload handler reads the entire multipart body without enforcing a maximum file size.
- **Impact**: An authenticated user can upload arbitrarily large files, exhausting R2 storage quota and/or causing memory pressure on the Worker.
- **Fix**: Check `file.size` immediately after parsing the form data and reject requests exceeding a reasonable limit (e.g. 50 MB):
  ```ts
  const MAX_BYTES = 50 * 1024 * 1024;
  if (file.size > MAX_BYTES) {
    return new Response(JSON.stringify({ error: "File too large" }), { status: 413 });
  }
  ```

---

### [MEDIUM] Recording Upload Does Not Verify Record Ownership

- **File**: `server/api/recordings.ts`
- **Issue**: `practiceRecordId` and `materialId` are taken from form data and written to R2/DB without confirming they belong to the authenticated user. A user can supply another user's IDs.
- **Impact**: An attacker can overwrite or corrupt another user's practice records.
- **Fix**: After parsing form data, query the DB to confirm ownership before writing:
  ```ts
  const record = await env.DB.prepare(
    "SELECT id FROM practice_records WHERE id = ? AND user_id = ?"
  ).bind(practiceRecordId, userId).first();
  if (!record) return new Response("Forbidden", { status: 403 });
  ```

---

### [MEDIUM] Weak Password Minimum Length

- **File**: `app/routes/register.tsx`
- **Issue**: Passwords are only required to be 6 characters with no complexity requirements.
- **Impact**: Brute-force attacks succeed faster; common passwords (e.g. `123456`) are accepted.
- **Fix**: Raise the minimum to 8 characters and enforce at least one digit or special character. Apply the same rule server-side in the action handler, not just the client form.

---

### [MEDIUM] Session Tokens Stored Unhashed in KV

- **File**: `server/services/auth.ts`
- **Issue**: The raw UUID session token is stored as the KV key. If KV is ever exposed (e.g. via a Cloudflare support incident or misconfigured API token), all active sessions are immediately usable.
- **Impact**: Session hijacking for every logged-in user.
- **Fix**: Store `SHA-256(token)` as the KV key and keep only the raw token in the cookie:
  ```ts
  const kvKey = await sha256Hex(token); // derive from crypto.subtle
  await env.KV.put(kvKey, JSON.stringify(sessionData), { expirationTtl: SESSION_TTL });
  ```

---

### [MEDIUM] No Explicit CSRF Protection on State-Changing Actions

- **File**: `workers/app.ts`, all `action` handlers
- **Issue**: Form actions rely entirely on same-site cookie behavior (`SameSite=Lax`). There are no CSRF tokens. `SameSite=Lax` does not protect top-level cross-site POST requests in all browsers.
- **Impact**: A crafted third-party page could trigger state-changing actions (e.g. submit material, complete practice) on behalf of a logged-in user.
- **Fix**: Generate a CSRF token on each page load, store it in the session, and validate it in every action handler. React Router's `<Form>` makes it straightforward to embed a hidden field.

---

### [LOW] R2 Audio Key Validated Only by Prefix, Not by DB Record

- **File**: `app/routes/api.audio.tsx`
- **Issue**: Authorization checks that the key starts with `audio/{user.id}/` or `recordings/{user.id}/`, but does not confirm the key exists as a DB record owned by the user. A malformed or guessed key with the correct prefix would be served.
- **Impact**: Low — the user-ID prefix makes guessing hard, but it is better to validate against the DB.
- **Fix**: After the prefix check, query the relevant table (e.g. `materials` or `practice_records`) to confirm the R2 key is recorded and belongs to the user.

---

### [LOW] `LIKE` Search Does Not Escape Wildcard Characters

- **File**: `server/db/queries.ts`
- **Issue**: User-supplied search strings are interpolated into a `LIKE` pattern as `%${search}%` without escaping `%` or `_`.
- **Impact**: Users can craft inputs (e.g. `%`) that match every row, which is a minor information-disclosure and performance concern, not an injection risk (query is parameterized).
- **Fix**:
  ```ts
  const escaped = search.replace(/[%_\\]/g, "\\$&");
  params.push(`%${escaped}%`);
  // and add ESCAPE '\' to the SQL clause
  ```

---

### [LOW] No Content Security Policy Header

- **File**: `workers/app.ts` (response pipeline)
- **Issue**: HTTP responses do not include a `Content-Security-Policy` header.
- **Impact**: If an XSS vector is ever introduced, there is no browser-level mitigation.
- **Fix**: Add a strict CSP header in the Worker fetch handler, e.g.:
  ```
  Content-Security-Policy: default-src 'self'; script-src 'self'; object-src 'none';
  ```

---

## Positive Findings

- **PBKDF2 password hashing**: 100,000 iterations with SHA-256 and a 16-byte random salt — meets current NIST recommendations.
- **Timing-safe password comparison**: `crypto.subtle.timingSafeEqual` is used correctly, preventing timing oracle attacks.
- **Parameterized SQL throughout**: Every D1 query uses `.bind()` with no string interpolation — zero SQL injection surface.
- **Rate limiting on login**: 5-attempt cap with a 15-minute KV-backed lockout, keyed per username.
- **Cookie attributes**: `HttpOnly`, `Secure`, `SameSite=Lax`, and `Max-Age` are all set correctly.
- **Generic login error messages**: "用户名或密码错误" is returned for both bad username and bad password — no user enumeration.
- **Ownership checks via DB JOINs**: Sensitive reads (plan items, materials) join back to `user_id`, preventing IDOR.
- **Session TTL and renewal**: 7-day expiry with KV-enforced TTL; sessions are renewed only after half the TTL elapses to reduce write pressure.
- **No hardcoded secrets**: API keys and DB credentials are injected via Cloudflare bindings and `env`, not committed to source.

---

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

---

Now I have all the data I need. Let me compile the final structured review report:

---

# Type Safety Review

## Summary

The Shadow Speaking codebase (React Router 7 + Cloudflare Workers, strict TypeScript enabled) demonstrates generally sound architectural choices but has a recurring pattern of bypassing type safety at system boundaries — particularly where D1 query results, external API responses, KV-stored JSON, and loader data cross type boundaries. The most serious risks concentrate in the auth/session pipeline and the AI service layer, where unguarded `JSON.parse` calls can crash the worker under adversarial or unexpected input.

---

## Issues Found

### [CRITICAL] `JSON.parse` on KV session data without try/catch

- **File**: `server/services/auth.ts:84`
- **Issue**: KV-stored session data is parsed directly: `JSON.parse(data) as { userId: string; expiresAt: string }`. If the stored value is corrupted, truncated, or manually modified, `JSON.parse` throws a `SyntaxError` that propagates unhandled through the auth middleware, crashing every authenticated request.
- **Risk**: Worker-level crash on any request that hits auth validation, effectively a denial of service triggered by a single corrupt KV entry. Also applies to lines 127 and 157 (login rate-limit data).
- **Fix**:
  ```ts
  let session: { userId: string; expiresAt: string };
  try {
    session = JSON.parse(data);
  } catch {
    await kv.delete(`session:${token}`);
    return null;
  }
  if (typeof session?.userId !== "string" || typeof session?.expiresAt !== "string") {
    return null;
  }
  ```

---

### [CRITICAL] `JSON.parse` on LLM tool-call arguments without try/catch

- **File**: `server/services/minimax.ts:141`
- **Issue**: `JSON.parse(toolCall.function.arguments) as MaterialAnalysis` — no try/catch. The LLM can return malformed JSON (partial responses, streaming artifacts, model refusals). If it does, the entire preprocessing pipeline crashes.
- **Risk**: Any content preprocessing request crashes with an unhandled exception, leaving materials permanently stuck in a "processing" state with no recovery path.
- **Fix**:
  ```ts
  let result: MaterialAnalysis;
  try {
    result = JSON.parse(toolCall.function.arguments);
  } catch {
    throw new Error("LLM returned invalid JSON in tool call arguments");
  }
  if (!result || typeof result.level !== "number") {
    throw new Error("LLM response missing required fields");
  }
  ```

---

### [CRITICAL] `NaN` silently passed to database from `Number()` on FormData

- **File**: `server/api/recordings.ts:12–14`
- **Issue**:
  ```ts
  const stage = Number(formData.get("stage") || 0);
  const round = Number(formData.get("round") || 1);
  const durationMs = Number(formData.get("durationMs") || 0);
  ```
  If the form field exists but is a non-numeric string (e.g. `"abc"`), `formData.get("stage")` returns `"abc"` (truthy), so `|| 0` doesn't apply, and `Number("abc")` evaluates to `NaN`. `NaN` passes the validation check at line 17 (only checks `!stage`) and is written to the database as `NULL`.
- **Risk**: Silent data corruption in the recordings table. `stage` being `NULL` or `NaN` can break spaced-repetition queries and practice analytics.
- **Fix**:
  ```ts
  const stage = parseInt(String(formData.get("stage") ?? ""), 10);
  if (!Number.isFinite(stage) || stage < 1) {
    return new Response(JSON.stringify({ error: "Invalid stage" }), { status: 400 });
  }
  ```

---

### [HIGH] Double-cast `as unknown as T` on loader data in multiple routes

- **Files**:
  - `app/routes/_app.corpus.$id.tsx:55–56`
  - `app/routes/_app.profile.tsx:35–36, 43`
  - `app/routes/_app.settings.tsx:51`
  - `app/routes/_app.today.$planItemId.tsx:113`
- **Issue**: The pattern `loaderData.x as unknown as SomeType` is used throughout. This is a double cast that tells TypeScript "trust me" with zero runtime validation. The loader returns D1 row data whose shape is never runtime-validated against the target interface.
- **Risk**: If the DB schema evolves, columns are renamed, or JOIN results produce unexpected shapes, the component silently accesses `undefined` fields, causing rendering errors or incorrect behavior that TypeScript won't catch.
- **Fix**: Define explicit return types on loaders and use the auto-generated `Route.LoaderArgs` / `Route.ComponentProps` types from `.react-router/types/`. For cross-boundary data, use a lightweight validation helper or Zod schema.

---

### [HIGH] `as any` passed to `PracticeFlow` component props

- **File**: `app/routes/_app.today.$planItemId.tsx:135`
- **Issue**: `<PracticeFlow material={material as any} ...>` — the entire material object is cast to `any`, disabling TypeScript checking on the most important prop of the most critical component in the app.
- **Risk**: Any mismatch between the loader's DB result shape and `PracticeFlow`'s expected `Material` type is completely invisible to the compiler. Field renames or missing JSON-parsed columns (e.g. `phonetic_notes`, `pause_marks`) will silently produce `undefined` values at runtime.
- **Fix**: Define a `Material` type that accurately reflects the JOIN result from `getTodayPlan()`, including that `phonetic_notes` / `tags` etc. arrive as raw JSON strings, and parse them in the loader before passing to the component.

---

### [HIGH] Unsafe environment variable access via `as unknown as Record<string, unknown>`

- **File**: `app/routes/_app.input.tsx:56`
- **Issue**:
  ```ts
  const apiKey = (env as unknown as Record<string, unknown>).MINIMAX_API_KEY as string;
  ```
  This casts `env` to bypass its declared type to access a key that may not exist in the `Env` interface, then asserts the result is a `string` without validation.
- **Risk**: If `MINIMAX_API_KEY` is not configured in the Cloudflare Worker environment, `apiKey` will be `undefined` at runtime despite being typed as `string`. This `undefined` is passed to `generateTTS` / `preprocessMaterial` where it becomes `Authorization: Bearer undefined`, causing silent API failures.
- **Fix**: Add `MINIMAX_API_KEY: string` to the `Env` interface in `worker-configuration.d.ts` and access it directly as `env.MINIMAX_API_KEY`. Validate it is non-empty before use.

---

### [HIGH] Dangerous intersection type on D1 JOIN result

- **File**: `server/db/queries.ts:235`
- **Issue**: `.all<PlanItem & Material>()` — the TypeScript intersection type `PlanItem & Material` asserts that every field from both interfaces is present and non-null. But this is a SQL JOIN result: columns can be `NULL`, field names can collide (e.g. both tables have `id`, `status`), and D1 does not validate shapes.
- **Risk**: Code that reads `item.id` will silently get the `plan_items.id` or `materials.id` depending on SQLite column ordering. Accessing `item.status` without knowing which table's `status` is returned can cause silent logic bugs in the spaced repetition and plan completion logic.
- **Fix**: Define an explicit `PlanItemWithMaterial` interface that models exactly the selected columns from the JOIN query, including aliases for ambiguous columns.

---

### [HIGH] `as unknown as { timingSafeEqual }` bypasses type system for security-critical function

- **File**: `server/services/auth.ts:50`
- **Issue**:
  ```ts
  return (crypto.subtle as unknown as { timingSafeEqual(...): boolean }).timingSafeEqual(a, b);
  ```
  This cast assumes `timingSafeEqual` is available on `crypto.subtle` in the Cloudflare Workers runtime, but it's not in the Web Crypto API standard — it's a Node.js-specific API. There's no runtime check for its existence.
- **Risk**: If the runtime doesn't expose this method (e.g. in test environments, or if Cloudflare removes it), calling the non-existent function throws `TypeError: ... is not a function`, crashing the entire login/password verification flow.
- **Fix**:
  ```ts
  if (typeof (crypto.subtle as any).timingSafeEqual === "function") {
    return (crypto.subtle as any).timingSafeEqual(a, b);
  }
  // Fallback: manual constant-time compare
  let result = 0;
  new Uint8Array(a).forEach((byte, i) => { result |= byte ^ new Uint8Array(b)[i]; });
  return result === 0;
  ```

---

### [MEDIUM] `(packs as any[])` in onboarding — no runtime shape validation

- **File**: `app/routes/onboarding.tsx:257`
- **Issue**: `(packs as any[]).map((pack: any) => { ... })` — both the array and element are typed as `any`. The loader returns D1 rows that are assumed to have `id`, `name`, `description`, `sentence_count` fields, but none are validated.
- **Risk**: If the `content_packs` table schema changes, or the query returns unexpected data, the render silently shows `undefined` in the UI (e.g. blank pack titles/descriptions) without any compile-time or runtime error.
- **Fix**: Define a `ContentPack` interface and use it as the generic type argument for `.all<ContentPack>()` in the loader, then use `useLoaderData<typeof loader>()` in the component for properly typed `packs`.

---

### [MEDIUM] SQLite boolean stored as `0/1` but typed as `number`, not `boolean`

- **File**: `server/db/queries.ts` — interfaces `PracticeRecord` (line 247), `Material` (boolean-semantic fields)
- **Issue**: Fields like `completed_all_stages: number`, `is_poor_performance: number`, `onboarding_completed: number` are semantically boolean but typed as `number`. Consumers that write `if (record.completed_all_stages)` work accidentally (0 is falsy), but `record.completed_all_stages === true` silently returns `false`.
- **Risk**: Medium — current code happens to use truthiness checks, but any future code doing strict boolean comparison will silently fail. Also misleading for new contributors.
- **Fix**: Either type them as `0 | 1` to document the constraint, or convert them to `boolean` in a mapping layer at the DB boundary.

---

### [MEDIUM] `formData.getAll("packs") as string[]` — no element validation

- **File**: `app/routes/onboarding.tsx:50`
- **Issue**: `formData.getAll("packs") as string[]` — `getAll` returns `FormDataEntryValue[]` which can contain `File` objects. The cast to `string[]` is unsafe.
- **Risk**: If a client submits file objects for the `packs` field (malformed or crafted request), downstream code calling `selectedPacks.includes(pack.id)` will compare strings against `File` objects, producing incorrect filtering behavior.
- **Fix**:
  ```ts
  const selectedPacks = formData.getAll("packs").filter((v): v is string => typeof v === "string");
  ```

---

### [MEDIUM] Unguarded access to `dupResults[i].results` in batch D1 responses

- **File**: `server/services/cold-start.ts:101–105`
- **Issue**: Batch D1 results are indexed with `dupResults[i].results` without checking that `dupResults[i]` is defined or that `.results` exists. D1's batch API can return fewer results than expected on partial failure.
- **Risk**: `TypeError: Cannot read properties of undefined` if the batch returns fewer results than the number of sentences being imported, silently skipping deduplication.
- **Fix**: Validate `dupResults.length === pack.sentences.length` before use, and guard each access with `dupResults[i]?.results ?? []`.

---

### [MEDIUM] `selfRating` cast without validation against allowed enum values

- **File**: `app/routes/_app.today.$planItemId.tsx:44`
- **Issue**: `const selfRating = formData.get("selfRating") as string | null` — `selfRating` is written directly to the database without validating it against the set of allowed rating values.
- **Risk**: Arbitrary strings can be stored in the `self_rating` column, potentially breaking analytics queries that filter on known rating values.
- **Fix**: Validate against allowed values: `const VALID_RATINGS = ["good", "ok", "hard"] as const; if (selfRating && !VALID_RATINGS.includes(selfRating as any)) { throw ... }`

---

### [MEDIUM] Tags stored as JSON string in DB but Material interface types it as `string`

- **File**: `server/db/queries.ts` (`Material` interface), `server/services/cold-start.ts:117`
- **Issue**: `sentence.tags` is `string[]` in the input type, stored as `JSON.stringify(sentence.tags)` (a JSON string). The `Material` interface types `tags` as `string`, which is technically correct for the raw DB value — but consumers in multiple places call `JSON.parse(material.tags)` expecting an array, with no guarantee the stored value is valid JSON.
- **Risk**: If `tags` was stored without `JSON.stringify` (or with a different format), `JSON.parse` in consumers throws or returns unexpected types. This is already partially mitigated in `corpus.$id.tsx` with `safeJsonParse`, but inconsistently applied.
- **Fix**: Apply `safeJsonParse` consistently wherever `material.tags` is read, or parse JSON fields eagerly in a single DB layer function that returns a fully-typed `MaterialParsed` object.

---

### [LOW] Non-null assertion on route param `planItemId!`

- **File**: `app/routes/_app.today.$planItemId.tsx:115`
- **Issue**: `formData.set("planItemId", planItemId!)` — `planItemId` comes from `useParams()`, which returns `string | undefined`. The non-null assertion is used instead of a guard.
- **Risk**: Low in practice (React Router won't render this component without the param matched), but if the component is ever used in a context where the param is absent, it silently sets `"undefined"` in the form.
- **Fix**: Use the typed `params` from `Route.ComponentProps` which guarantees the param's presence for this route.

---

### [LOW] Missing explicit return type annotations on exported server functions

- **Files**: `server/services/plan-generator.ts`, `server/services/spaced-repetition.ts`, `server/cron/daily-plan.ts`
- **Issue**: Several exported async functions lack explicit return type annotations, relying on inference. This is acceptable with strict mode but makes the public API contract harder to review and can mask breaking changes.
- **Risk**: Low — TypeScript inference is generally correct here, but return type changes won't be caught at call sites without re-type-checking all consumers.
- **Fix**: Add explicit `Promise<void>`, `Promise<PlanItem[]>`, etc. to exported functions.

---

## Positive Findings

- **Strict mode is enabled** across all `tsconfig*.json` files — `strict: true` catches the majority of common TypeScript errors automatically.
- **`safeJsonParse` helper** is defined and used in `corpus.$id.tsx` and `PracticeFlow.tsx` — good defensive pattern that should be extracted and applied universally.
- **`useLoaderData<typeof loader>()`** and **`useActionData<typeof action>()`** are correctly used in most routes, providing good type inference from loader/action return types.
- **`formData.get()` defensively wrapped** in most auth routes (`login.tsx`, `register.tsx`) using `String(...|| "")` — prevents `null` values from propagating.
- **Null guards after D1 `.first()` calls** are consistently present (e.g. `if (!user) return;`, `if (!material) ...`) across server code.
- **Rate limiting with lockout** is implemented in the auth service with proper TTLs — good security pattern even if the JSON parsing around it needs hardening.
- **`crypto.subtle`-based timing-safe comparison** intent is correct — constant-time comparison for passwords is the right approach; just needs the runtime existence check.
- **React Router's `Route.ComponentProps`** typing is used correctly in layout components like `_app.tsx`, providing proper typing for `loaderData`.

---

I now have enough context to produce the complete review report. Here it is:

---

# Business Logic Review

## Summary

The core spaced repetition and streak logic is mostly correct, but there are several significant bugs: the cron job updates streak based on plan generation (not actual practice), the mastery threshold is dangerously low (3 reviews), the level progression check never actually promotes the user, and the cron uses tomorrow's date creating a timezone mismatch with the practice handler which uses UTC+8 today. The plan generator also silently returns `null` when there are no eligible items, giving no feedback mechanism.

---

## Issues Found

### [CRITICAL] Streak reset runs in cron on plan generation, not on actual practice

- **File**: `server/cron/daily-plan.ts:26-33`
- **Issue**: `updateStreak()` is called inside `handleDailyPlanCron` when a plan is *generated*, not when the user actually *practices*. This function resets `streak_days = 0` if the user didn't practice yesterday — but it fires at cron time (UTC 20:00, Beijing 04:00 next morning), not after the user completes a session.
- **Impact**: A user who practiced yesterday and has a valid streak will get it reset to 0 in the early morning before they ever open the app, because the cron resets the streak when it generates tomorrow's plan. Meanwhile, the real streak update in `server/api/practice.ts:60-107` correctly increments after a session. The two codepaths are in conflict.
- **Fix**: Remove `updateStreak()` entirely from the cron. Streak should only be updated in `updateUserStreak()` inside `handlePracticeComplete`. The cron's streak function serves no valid purpose and corrupts user data.

---

### [CRITICAL] Level progression is calculated but never applied

- **File**: `server/services/level-assessor.ts:1-44`
- **Issue**: `checkLevelProgression()` returns `{ shouldUpgrade: false, inObservation: true }` when all conditions are met, but never `shouldUpgrade: true`. There is no code path anywhere that sets `shouldUpgrade = true`. There is also no caller in the codebase that reads `inObservation` and schedules the observation period or eventually promotes the user.
- **Impact**: Users can never advance to the next level automatically. The level progression feature is entirely non-functional despite the mastery tracking being in place.
- **Fix**: Either add a second-pass check after the observation period (e.g., 3 days of continued good performance) that returns `shouldUpgrade: true`, or connect `checkLevelProgression` to a cron or post-practice hook that calls `updateUserSettings(db, userId, { level: currentLevel + 1 })`.

---

### [HIGH] Mastery requires only 3 successful reviews — far too low

- **File**: `server/services/spaced-repetition.ts:45-53`
- **Issue**: `newStatus = "mastered"` triggers when `newReviewCount >= 3 && completedAllStages && selfRating !== "poor"`. With `REVIEW_INTERVALS = [1, 2, 4, 7, 16, 30, 60]`, the 3rd review happens on day 1+2+4 = **day 7**. A sentence practiced 3 times in one week gets permanently retired from the review queue.
- **Impact**: Items graduate to "mastered" far too early. Mastered items are never included in future plans (no query selects `status = 'mastered'`), so users lose spaced repetition benefit for items they haven't truly internalized. For a language learning app this is a severe learning effectiveness regression.
- **Fix**: Raise the mastery threshold to at least 5-6 reviews (covering the 30-day interval), requiring the user to have successfully reviewed the item at wider time gaps.

---

### [HIGH] Cron generates plan for `tomorrow` but today's page loader uses UTC+8 `today`

- **File**: `server/cron/daily-plan.ts:5-7` vs `app/routes/_app.today.tsx:15-17`
- **Issue**: The cron calculates `tomorrow` in pure UTC: `tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)`. The today loader calculates `today` as `new Date(now.getTime() + 8*60*60*1000)`. For a user in UTC+8, the cron runs at 04:00 local time on the target date. If the cron fires at UTC 20:00, `tomorrow` in UTC = the same calendar date as `today` in UTC+8. So the plan date *should* match — but only for UTC+8. Users in UTC-5 (EST) would have the cron generate a plan for the wrong date because `tomorrow` UTC ≠ `today` UTC-5.
- **Impact**: Users outside UTC+8 will see no plan for today (cron generated it for a different date string), or see yesterday's plan offered as today's. The hardcoded China timezone in practice.ts but UTC-based cron creates a permanent inconsistency for non-China users.
- **Fix**: Pick one timezone and use it consistently: either always UTC, or always UTC+8. Pass timezone as a config/env variable rather than hardcoding it in two different places with different logic.

---

### [HIGH] `completedAllStages` is hardcoded to `1` in the practice action

- **File**: `server/api/practice.ts:22`
- **Issue**: The INSERT into `practice_records` hardcodes `completed_all_stages = 1`. The `handlePracticeComplete` function then passes `completedAllStages: true` to `updateMaterialAfterPractice`. A user who exits mid-practice (or where the action is invoked any other way) will always have their session recorded as "completed all stages."
- **Impact**: The mastery condition `practice.completedAllStages` is always `true`, removing one of the three mastery safeguards entirely. Combined with the low review count threshold, mastery is now determined solely by review count ≥ 3 and self-rating ≠ "poor".
- **Fix**: Actually pass the `completedAllStages` boolean from the form data in `_app.today.$planItemId.tsx` action, and use it in the INSERT.

---

### [HIGH] Cron `updateStreak` checks `last_practice_date` against a plan date (tomorrow), not today

- **File**: `server/cron/daily-plan.ts:50-66`
- **Issue**: The function computes `yesterday` relative to `date` (which is tomorrow's date). So it checks: "Did the user practice the day before tomorrow?" = "Did they practice today?" This means if the user *has* practiced today, the streak is left alone. If they haven't (e.g., it's 04:00 AM and they haven't practiced yet), the streak is reset before the day even ends.
- **Impact**: Any user who hasn't practiced by midnight UTC (08:00 Beijing) on the current day will have their streak reset at the cron run, even though they have the entire remaining day to practice.
- **Fix**: Don't reset streaks proactively in the cron. Streak breaks should be computed lazily in `updateUserStreak()` at practice time, comparing `last_practice_date` to the day before the current practice date.

---

### [MEDIUM] `regenerateDailyPlan` has a partial-delete race condition

- **File**: `server/services/plan-generator.ts:142-149`
- **Issue**: The batch deletes `plan_items WHERE status = 'pending'` and `daily_plans WHERE completed_items = 0` atomically. However, between the check `existingPlan.completed_items > 0` (line 136) and the batch delete, a concurrent user session could complete a plan item, incrementing `completed_items`. The DELETE on `daily_plans` will then silently fail (condition `completed_items = 0` no longer true), but the plan_items DELETE already ran, orphaning pending items under an existing plan.
- **Impact**: A user who completes an item while simultaneously clicking "regenerate" could end up with a corrupted plan missing some pending items but still having the plan header.
- **Fix**: Use a single transaction or recheck `completed_items = 0` inside the batch with a conditional delete, or lock the plan row before operating.

---

### [MEDIUM] New materials sorted by `created_at DESC` (newest first) instead of oldest first

- **File**: `server/services/plan-generator.ts:62-69`
- **Issue**: New materials are fetched `ORDER BY created_at DESC LIMIT ?`, meaning the most recently added items are prioritized over older, long-waiting ones.
- **Impact**: If a user adds materials frequently, older materials may never get scheduled (LIFO starvation). A user who added 50 items a week ago will never see them if they keep adding new ones.
- **Fix**: Change to `ORDER BY created_at ASC` to practice materials in the order they were added (FIFO), ensuring all items eventually get practiced.

---

### [MEDIUM] Level filter for new materials allows level = user.level + 1

- **File**: `server/services/plan-generator.ts:63-65`
- **Issue**: New materials are filtered `level <= user.level + 1`, meaning a Level 1 user is assigned Level 2 materials before mastering Level 1.
- **Impact**: Users who set themselves to Level 1 (beginner) will immediately receive harder Level 2 content in their daily plans if they have any. This contradicts the level system's purpose.
- **Fix**: Change to `level <= user.level` to only introduce materials at or below the user's current level. The +1 offset should only apply *after* level promotion.

---

### [MEDIUM] `checkRetirementProtection` result is never acted upon

- **File**: `server/services/level-assessor.ts:46-70`
- **Issue**: `checkRetirementProtection()` returns `{ shouldReduceNew: boolean }` but there is no caller in the codebase that reads this result or adjusts `newSlots` in `generateDailyPlan`.
- **Impact**: The burnout-prevention feature is completely dead code. Users who complete <50% of their plans for 3 consecutive days will continue to receive the same volume of new material.
- **Fix**: Call `checkRetirementProtection` in `generateDailyPlan` before computing `newSlots`, and if `shouldReduceNew` is true, set `newSlots = 0` or halve it.

---

### [MEDIUM] Practice calendar in profile uses client-local timezone, not UTC+8

- **File**: `app/routes/_app.profile.tsx:173-176`
- **Issue**: The calendar renders dates using `new Date()` and `date.getDate() - 29 + i` without timezone adjustment. The practice records are stored as `datetime('now')` (UTC), but the calendar compares against local JavaScript `Date`.
- **Impact**: Users in other timezones will see misaligned calendar dots — a practice at 23:30 UTC could show as the next day in UTC+8, creating a gap that looks like a missed day.
- **Fix**: Apply the same UTC+8 offset used elsewhere, or standardize all date storage to include timezone context.

---

### [LOW] Poor performance resets `review_count` to 0 but keeps `status = "learning"`

- **File**: `server/services/spaced-repetition.ts:25-31`
- **Issue**: On poor performance, `reviewCount: 0` and `nextReviewDate: addDays(today, 1)`, but the status stays `"learning"` (the `newStatus` is set from `material.status`, not reset). This is intentional behavior, but `review_count = 0` means the *next* successful review will map to `REVIEW_INTERVALS[0] = 1` day, treating the item as if it's at interval index 0 (`Math.min(newReviewCount - 1, ...)` where `newReviewCount = 1`). This is correct. However, the mastery check `newReviewCount >= 3` will now require 3 *additional* successful reviews after a poor rating — meaning the item cannot be mastered until 3 clean reviews post-reset.
- **Impact**: Minor learning friction for items that are reset repeatedly, but the behavior is actually correct from a pedagogical standpoint. Just worth documenting.

---

### [LOW] `onboarding.tsx` step advancement uses `useEffect` with stale closure risk

- **File**: `app/routes/onboarding.tsx:83-93`
- **Issue**: The `useEffect` that advances `currentStep` depends on both `actionData` and `currentStep`. The step-to-action mapping is hardcoded (e.g., `step === "level" && currentStep === 2`), but the onboarding steps are defined in the opposite order than the action data (`level` is step 2 in the server but step 2 progresses to step 3 in the client).
- **Impact**: If a user navigates backward (e.g., uses browser back), the `useEffect` might not re-fire correctly, potentially skipping steps or not advancing. Low risk for a linear flow.

---

## Positive Findings

- **Idempotent plan generation**: `generateDailyPlan` correctly checks for an existing plan before creating one, preventing duplicate plans on repeated page loads or cron re-runs.
- **Authorization is thorough**: Every route action validates material and plan item ownership via JOIN queries before processing (e.g., `_app.today.$planItemId.tsx:50-70`), preventing cross-user data access.
- **D1 batch API usage**: Both `cold-start.ts` and `preprocessor.ts` correctly use `db.batch()` for N+1 duplicate checks, which is the right pattern for Cloudflare D1's network-bound latency.
- **`addDays` is timezone-safe**: The date arithmetic in `spaced-repetition.ts:90-94` correctly appends `T00:00:00Z` and uses `setUTCDate`/`getUTCDate`, avoiding DST-related off-by-one errors.
- **Duplicate detection on import**: Both cold-start and the preprocessor check for existing content before inserting, preventing duplicate materials in the corpus.
- **Plan batched atomically**: `generateDailyPlan` wraps the plan header and all plan items in a single `db.batch()` call, ensuring the plan is never partially written.
- **Soft mastery conditions**: The three-condition mastery gate (`review_count >= 3 && completedAllStages && selfRating !== "poor"`) shows good design intent — the threshold just needs raising.
- **`regenerateDailyPlan` guards completed work**: Correctly refuses to regenerate if `completed_items > 0`, protecting user progress from accidental data loss.

---

Now I have a thorough understanding of the codebase. Let me produce the review report:

---

# Cloudflare Compatibility Review

## Summary

Shadow Speaking is a React Router 7 + Cloudflare Workers SSR application that uses D1 (database), R2 (audio storage), KV (sessions), and a daily Cron trigger. The platform usage is generally solid, but several issues ranging from a potential CPU-time overrun in the preprocessing pipeline to missing wrangler secrets configuration and a race condition in rate limiting could cause problems in production.

---

## Issues Found

### [CRITICAL] `preprocessMaterial` runs synchronously inside `waitUntil`, risking CPU timeout

- **File**: `server/services/minimax.ts:196-270`, called from `app/routes/_app.input.tsx:58-76`
- **Issue**: `waitUntil()` is correct to use for background work, but the loop inside it calls `analyzeSentence` (one LLM round-trip) then `generateTTS` **three times** sequentially per sentence, all inside a single Worker invocation. A user can paste up to 5000 characters. `splitSentences` could return 20+ sentences. Each sentence triggers 4 external HTTP calls (1 LLM + 3 TTS). Workers have a **30-second CPU time limit** on the paid plan; external fetch time does not count against CPU time, but the total wall-clock time of a `waitUntil` task is bounded by the **30-second subrequest wall time** and the overall **script execution timeout**.
- **Impact**: Batches of many sentences will time out mid-processing, leaving materials stuck in `preprocess_status = 'processing'` forever with no retry or recovery path.
- **Fix**: Process sentences in parallel (e.g. `Promise.all` or batches of 3-5), and add a retry mechanism — or push each sentence into a Cloudflare Queue for independent processing.

---

### [CRITICAL] MINIMAX_API_KEY not declared in `wrangler.jsonc` and accessed unsafely

- **File**: `app/routes/_app.input.tsx:56`, `wrangler.jsonc`
- **Issue**: The API key is accessed via `(env as unknown as Record<string, unknown>).MINIMAX_API_KEY`. This double cast bypasses TypeScript's `Env` type entirely, meaning the key is **not declared** as a Wrangler secret binding. If the secret is not provisioned in production, `apiKey` is `undefined` and preprocessing is silently skipped — materials are created with `preprocess_status = 'pending'` but never processed.
- **Impact**: Silent data corruption: users add materials that appear to have been accepted but never get processed. No error is surfaced to the user.
- **Fix**: Add `MINIMAX_API_KEY` to `wrangler.jsonc` as a secret (`wrangler secret put MINIMAX_API_KEY`) and declare it in `worker-configuration.d.ts` / the `Env` interface so it is typed and validated at deployment.

---

### [HIGH] TTS audio is fully buffered into memory before R2 upload

- **File**: `server/services/minimax.ts:190-191`, `minimax.ts:225`
- **Issue**: `await response.arrayBuffer()` buffers the entire TTS MP3 into Worker memory. Three versions are generated per sentence. Workers have a **128 MB memory limit**. For long sentences at high quality, each MP3 could be several MB. With many sentences processed concurrently, this will exceed the memory limit.
- **Impact**: Out-of-memory crash (`Worker exceeded memory limit`) causing the background task to fail silently.
- **Fix**: Stream the response body directly to R2 using `r2.put(key, response.body, ...)`. R2 accepts a `ReadableStream` directly.

```ts
// Instead of:
const audioBuffer = await response.arrayBuffer();
await r2.put(key, audioBuffer, { httpMetadata: ... });

// Use:
await r2.put(key, response.body!, { httpMetadata: ... });
```

---

### [HIGH] Cron job iterates all users with sequential `await` — will timeout at scale

- **File**: `server/cron/daily-plan.ts:19-33`
- **Issue**: The cron handler loops over all onboarded users with sequential `await generateDailyPlan(...)` and `await updateStreak(...)` calls. Each user requires multiple D1 queries. A Cron trigger has a **maximum execution time of 15 minutes** (paid) or **30 seconds** (free), and D1 queries add up quickly.
- **Impact**: With hundreds of users, the cron will time out before finishing, leaving many users without a daily plan. The job also lacks idempotency checking at the job level (each `generateDailyPlan` checks for existing plans, so partial re-runs are safe at the record level, but the global loop won't resume where it left off).
- **Fix**: Use `Promise.all` with a concurrency limiter (e.g., process 10 users at a time) to parallelize D1 operations. Consider using Cloudflare Queues or Durable Objects for fan-out at larger scale.

---

### [HIGH] KV rate limiter is vulnerable to race conditions (TOCTOU)

- **File**: `server/services/auth.ts:116-170`
- **Issue**: `checkLoginRateLimit` reads the KV value and returns a decision; `recordLoginAttempt` reads it again and increments the counter — two separate KV operations with no atomicity guarantee. Since KV has eventual consistency and no compare-and-swap, an attacker can fire many concurrent login attempts and bypass the 5-attempt limit before the counter is updated.
- **Impact**: Rate limiting is bypassable under concurrent load, enabling brute-force attacks on user credentials.
- **Fix**: For true rate limiting, use Cloudflare's **Rate Limiting API** or a Durable Object with atomic state. If staying with KV, collapse check and record into a single write with a short TTL, accepting that it is best-effort.

---

### [HIGH] R2 audio endpoint has no `Range` request support

- **File**: `app/routes/api.audio.tsx:19-28`
- **Issue**: The audio loader returns `object.body` without handling `Range` headers. Browsers and native audio elements send `Range` requests to seek within audio files. Without range support, `<audio>` elements cannot seek, and the entire file must be downloaded before playback begins. R2's `get()` accepts a `range` option.
- **Impact**: Poor user experience: seeking in recordings fails silently; mobile Safari may refuse to play audio at all without a 206 response.
- **Fix**:
```ts
const rangeHeader = request.headers.get("Range");
const range = rangeHeader ? parseRange(rangeHeader) : undefined;
const object = await env.R2.get(key, { range });
const status = range ? 206 : 200;
if (range && object?.range) {
  headers.set("Content-Range", `bytes ${object.range.offset}-${object.range.end}/${object.size}`);
}
return new Response(object.body, { status, headers });
```

---

### [MEDIUM] `getUserMaterials` issues two separate D1 queries — no batching

- **File**: `server/db/queries.ts:86-101`
- **Issue**: `getUserMaterials` runs a `COUNT(*)` query and then a paginated `SELECT` query. These could be combined into a single `db.batch()` call, halving the D1 round-trips.
- **Impact**: Slightly increased latency on every corpus page load; counts toward D1 read operation billing.
- **Fix**: Use `db.batch([countStmt, dataStmt])` and destructure both results.

---

### [MEDIUM] `db.batch()` in `generateDailyPlan` could exceed the 100-statement limit

- **File**: `server/services/plan-generator.ts:97-117`
- **Issue**: The batch starts with 1 plan insert, then adds one statement per plan item. If a user has 120+ minutes of daily practice (`daily_minutes / 2 = 60+` slots), the batch could approach or exceed D1's **100-statement per batch** limit.
- **Impact**: `db.batch()` throws when the limit is exceeded, causing plan generation to fail entirely.
- **Fix**: Cap `totalSlots` at a safe maximum (e.g., 50), or split the batch into chunks of ≤99 statements.

---

### [MEDIUM] `handleRecordingUpload` buffers the entire audio file in memory

- **File**: `server/api/recordings.ts:29-32`
- **Issue**: `await file.arrayBuffer()` loads the WebM recording fully into memory before uploading to R2. WebM recordings from extended practice sessions could be several MB.
- **Impact**: Contributes to memory pressure in the 128 MB Worker limit, especially if multiple users submit recordings concurrently.
- **Fix**: Use `r2.put(r2Key, file.stream(), { httpMetadata: ... })` to stream the `File` object directly.

---

### [MEDIUM] No `Content-Length` or `ETag` on R2 audio responses

- **File**: `app/routes/api.audio.tsx:24-28`
- **Issue**: The audio response omits `Content-Length` and `ETag` headers, both of which R2 provides via `object.size` and `object.etag`. Without `Content-Length`, browsers cannot show download progress or properly pre-buffer audio. Without `ETag`, cache validation (`If-None-Match`) doesn't work, causing unnecessary re-downloads.
- **Impact**: Degraded audio streaming performance and unnecessary bandwidth consumption.
- **Fix**: Add `headers.set("Content-Length", String(object.size))` and `headers.set("ETag", object.etag)`.

---

### [MEDIUM] `handlePracticeComplete` makes 4–5 sequential D1 writes without batching

- **File**: `server/api/practice.ts:18-56`
- **Issue**: Practice completion runs: `INSERT practice_records` → `UPDATE plan_items` → `UPDATE daily_plans` (subquery) → `updateMaterialAfterPractice` (separate queries) → `updateUserStreak` (SELECT + UPDATE). This is 5–7 sequential D1 round-trips on the hot path for every practice session completion.
- **Impact**: High latency on the most frequent user action; each D1 round-trip in a Workers context adds ~10-50ms.
- **Fix**: Where possible, consolidate writes into `db.batch()` calls. The plan item update and plan count update are natural candidates.

---

### [MEDIUM] Session renewal can return a stale `expiresAt` to the caller

- **File**: `server/services/auth.ts:77-102`
- **Issue**: When `getSession` renews the session (line 94-98), it writes a new `expiresAt` to KV but then returns the **old** `session` object (line 101) with the original `expiresAt`. Any caller inspecting `session.expiresAt` will see a stale time. More critically, KV writes are eventually consistent — the renewal write may not be immediately visible.
- **Impact**: Low severity in practice, but could cause confusion if `expiresAt` is ever used by callers for expiry display or logic.
- **Fix**: Return `{ ...session, expiresAt: newExpiresAt }` after renewal.

---

### [LOW] Wrangler config uses placeholder IDs — deployment will fail

- **File**: `wrangler.jsonc:14, 33`
- **Issue**: Both `database_id: "placeholder-id"` (D1) and KV `id: "placeholder-id"` are literal placeholder strings that will cause `wrangler deploy` to fail or connect to non-existent resources.
- **Impact**: Deployment blocked until corrected.
- **Fix**: Run `wrangler d1 create shadow-speaking-db` and `wrangler kv namespace create shadow-speaking-kv` and replace with the returned IDs.

---

### [LOW] `timingSafeEqual` is cast from `crypto.subtle` non-standardly

- **File**: `server/services/auth.ts:50`
- **Issue**: `crypto.subtle.timingSafeEqual` is a Cloudflare Workers **non-standard extension** of the Web Crypto API. The double cast `(crypto.subtle as unknown as { timingSafeEqual(...): boolean })` works but is fragile — if Cloudflare changes this API or the code runs in a different environment (tests, edge runtime), it will throw a TypeError at runtime.
- **Impact**: Potential runtime crash if run outside Workers, or subtle test/CI failures.
- **Fix**: Add a fallback: `if (typeof (crypto.subtle as any).timingSafeEqual === 'function') { ... } else { /* constant-time loop fallback */ }`. Alternatively, document the Workers-only dependency explicitly.

---

### [LOW] No `robots.txt` or cache headers on static assets

- **File**: `wrangler.jsonc`
- **Issue**: There is no `assets` binding or static asset configuration in `wrangler.jsonc`. Static assets served through the SSR React Router handler incur Worker CPU time for every request.
- **Impact**: Unnecessary Worker invocations for public static files; potential cost impact at scale.
- **Fix**: Add an `assets` binding in `wrangler.jsonc` to serve static assets from Cloudflare's edge cache directly, bypassing the Worker for non-dynamic requests.

---

## Positive Findings

- **Correct `waitUntil` usage**: The preprocessing pipeline correctly uses `ctx.waitUntil()` to avoid blocking the HTTP response (`_app.input.tsx:58`).
- **Web Crypto API only**: All cryptographic operations use `crypto.subtle` (PBKDF2, timingSafeEqual) — no Node.js `crypto` module dependency, fully compatible with the Workers runtime.
- **Proper D1 parameterization**: All queries use `.prepare().bind()` with no string interpolation, preventing SQL injection throughout `queries.ts`.
- **Observability enabled**: `observability: { enabled: true }` in `wrangler.jsonc` enables Workers Logpush out of the box.
- **`nodejs_compat` flag**: Correctly set, enabling Node.js API compatibility needed for `uuid` and the OpenAI SDK.
- **HttpOnly + Secure cookies**: Session cookies are correctly set with `HttpOnly; Secure; SameSite=Lax` (`auth.ts:176-177`).
- **User-scoped R2 key validation**: The audio route validates that keys belong to the requesting user before serving (`api.audio.tsx:14-16`), preventing IDOR attacks.
- **Idempotent plan generation**: `generateDailyPlan` checks for an existing plan before creating one (`plan-generator.ts:25-32`), making it safe to call multiple times.
- **D1 batch for plan creation**: Plan header + all items are created atomically with `db.batch()` in `plan-generator.ts:117`, avoiding partial plan states.
- **KV TTL on sessions**: Sessions have a correct 7-day `expirationTtl` set directly on the KV write, so they are auto-expired by KV even if `destroySession` is never called.

---

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
