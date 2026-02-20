import { updateMaterialAfterPractice } from "../services/spaced-repetition";
import { checkLevelProgression } from "../services/level-assessor";

const VALID_RATINGS = ["good", "fair", "poor"] as const;

interface PracticeCompleteResult {
  accepted: boolean;
  recordId: string | null;
  reason?: "already_completed";
}

export async function handlePracticeComplete(
  db: D1Database,
  userId: string,
  materialId: string,
  planItemId: string | null,
  selfRating: string | null,
  isPoorPerformance: boolean,
  durationSeconds: number,
  completedAllStages: boolean = true
): Promise<PracticeCompleteResult> {
  // Validate selfRating
  if (selfRating && !VALID_RATINGS.includes(selfRating as any)) {
    selfRating = null;
  }

  // Use UTC+8 (China time) for consistent date handling
  const now = new Date();
  const chinaOffset = 8 * 60 * 60 * 1000;
  const today = new Date(now.getTime() + chinaOffset).toISOString().slice(0, 10);

  let planId: string | null = null;
  let previousPlanItemStatus: "pending" | "in_progress" | null = null;
  let recordId: string | null = null;
  let didIncrementPlanCount = false;

  try {
    // CAS: only first completion of a plan item is accepted
    if (planItemId) {
      const planItem = await db
        .prepare("SELECT plan_id, status FROM plan_items WHERE id = ?")
        .bind(planItemId)
        .first<{ plan_id: string; status: string }>();

      if (!planItem || planItem.status === "completed") {
        return { accepted: false, recordId: null, reason: "already_completed" };
      }
      if (planItem.status !== "pending" && planItem.status !== "in_progress") {
        return { accepted: false, recordId: null, reason: "already_completed" };
      }

      planId = planItem.plan_id;
      previousPlanItemStatus = planItem.status;

      const completionResult = await db
        .prepare(
          `UPDATE plan_items
           SET status = 'completed',
               completed_at = COALESCE(completed_at, datetime('now'))
           WHERE id = ? AND status = ?`
        )
        .bind(planItemId, previousPlanItemStatus)
        .run();

      if (completionResult.meta.changes === 0) {
        return { accepted: false, recordId: null, reason: "already_completed" };
      }

      await db
        .prepare(
          `UPDATE daily_plans
           SET completed_items = CASE
             WHEN completed_items < total_items THEN completed_items + 1
             ELSE total_items
           END
           WHERE id = ?`
        )
        .bind(planId)
        .run();
      didIncrementPlanCount = true;
    }

    recordId = crypto.randomUUID();
    await db
      .prepare(
        `INSERT INTO practice_records
         (id, user_id, material_id, plan_item_id, completed_all_stages, self_rating, is_poor_performance, duration_seconds)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        recordId,
        userId,
        materialId,
        planItemId,
        completedAllStages ? 1 : 0,
        selfRating,
        isPoorPerformance ? 1 : 0,
        durationSeconds
      )
      .run();

    // Core learning state update (critical)
    await updateMaterialAfterPractice(
      db,
      materialId,
      {
        completedAllStages,
        selfRating,
        isPoorPerformance,
      },
      today
    );

    // Non-critical side effects: keep completion successful even if these fail.
    try {
      await updateUserStreak(db, userId, today);
    } catch (streakError) {
      console.error("[Practice] Failed to update streak:", streakError);
    }

    try {
      const user = await db
        .prepare("SELECT level FROM users WHERE id = ?")
        .bind(userId)
        .first<{ level: number }>();

      if (user && user.level < 5) {
        const { shouldUpgrade } = await checkLevelProgression(
          db,
          userId,
          user.level,
          today
        );
        if (shouldUpgrade) {
          // CAS: only upgrade if level hasn't changed since we read it (prevents double-upgrade on concurrent requests)
          await db
            .prepare("UPDATE users SET level = level + 1 WHERE id = ? AND level = ?")
            .bind(userId, user.level)
            .run();
        }
      }
    } catch (levelError) {
      console.error("[Practice] Failed to evaluate level progression:", levelError);
    }

    return { accepted: true, recordId };
  } catch (error) {
    // Best-effort compensation: avoid locking plan item in completed state on partial failures
    try {
      let didRollbackPlanItem = !planItemId;

      if (planItemId && planId && previousPlanItemStatus) {
        const rollbackItemResult = await db
          .prepare(
            "UPDATE plan_items SET status = ?, completed_at = NULL WHERE id = ? AND status = 'completed'"
          )
          .bind(previousPlanItemStatus, planItemId)
          .run();
        didRollbackPlanItem = rollbackItemResult.meta.changes > 0;

        // Only decrement plan counters if we actually rolled the item state back.
        if (didIncrementPlanCount && didRollbackPlanItem) {
          await db
            .prepare(
              "UPDATE daily_plans SET completed_items = CASE WHEN completed_items > 0 THEN completed_items - 1 ELSE 0 END WHERE id = ?"
            )
            .bind(planId)
            .run();
        }
      }

      // Keep practice record when item rollback fails, to avoid "completed item with no record".
      if (recordId && didRollbackPlanItem) {
        await db
          .prepare("DELETE FROM practice_records WHERE id = ?")
          .bind(recordId)
          .run();
      } else if (recordId && !didRollbackPlanItem) {
        console.error(
          "[Practice] Skip deleting practice record because plan item rollback failed",
          { recordId, planItemId, planId }
        );
      }
    } catch (compensationError) {
      console.error("[Practice] Compensation failed:", compensationError);
    }

    console.error("[Practice] Completion failed", {
      userId,
      materialId,
      planItemId,
      planId,
      recordId,
      didIncrementPlanCount,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

async function updateUserStreak(
  db: D1Database,
  userId: string,
  today: string
): Promise<void> {
  const MAX_CAS_RETRIES = 5;

  for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt++) {
    const user = await db
      .prepare(
        "SELECT last_practice_date, streak_days, max_streak_days, total_practice_days FROM users WHERE id = ?"
      )
      .bind(userId)
      .first<{
        last_practice_date: string | null;
        streak_days: number;
        max_streak_days: number;
        total_practice_days: number;
      }>();

    if (!user) return;

    // Already practiced today
    if (user.last_practice_date === today) return;

    const yesterday = new Date(today + "T00:00:00Z");
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const yesterdayStr = yesterday.toISOString().slice(0, 10);

    const newStreak =
      user.last_practice_date === yesterdayStr ? user.streak_days + 1 : 1;
    const newMax = Math.max(newStreak, user.max_streak_days);
    const newTotal = user.total_practice_days + 1;

    const update = await db
      .prepare(
        `UPDATE users SET
          last_practice_date = ?,
          streak_days = ?,
          max_streak_days = ?,
          total_practice_days = ?
         WHERE id = ?
           AND ifnull(last_practice_date, '') = ifnull(?, '')
           AND streak_days = ?
           AND max_streak_days = ?
           AND total_practice_days = ?`
      )
      .bind(
        today,
        newStreak,
        newMax,
        newTotal,
        userId,
        user.last_practice_date,
        user.streak_days,
        user.max_streak_days,
        user.total_practice_days
      )
      .run();

    if (update.meta.changes > 0) {
      return;
    }
  }

  console.warn(`[Practice] Failed to update streak with CAS for user ${userId}`);
}
