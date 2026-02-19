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
