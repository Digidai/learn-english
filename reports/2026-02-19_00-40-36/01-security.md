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
