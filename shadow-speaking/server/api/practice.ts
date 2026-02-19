import { updateMaterialAfterPractice } from "../services/spaced-repetition";

const VALID_RATINGS = ["good", "fair", "poor"] as const;

export async function handlePracticeComplete(
  db: D1Database,
  userId: string,
  materialId: string,
  planItemId: string | null,
  selfRating: string | null,
  isPoorPerformance: boolean,
  durationSeconds: number,
  completedAllStages: boolean = true
): Promise<string> {
  // Validate selfRating
  if (selfRating && !VALID_RATINGS.includes(selfRating as any)) {
    selfRating = null;
  }

  // Use UTC+8 (China time) for consistent date handling
  const now = new Date();
  const chinaOffset = 8 * 60 * 60 * 1000;
  const today = new Date(now.getTime() + chinaOffset).toISOString().slice(0, 10);

  // Create practice record
  const recordId = crypto.randomUUID();

  // Batch the initial writes that don't depend on each other
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO practice_records
         (id, user_id, material_id, plan_item_id, completed_all_stages, self_rating, is_poor_performance, duration_seconds)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(recordId, userId, materialId, planItemId, completedAllStages ? 1 : 0, selfRating, isPoorPerformance ? 1 : 0, durationSeconds),
  ];

  if (planItemId) {
    statements.push(
      db
        .prepare(
          "UPDATE plan_items SET status = 'completed', completed_at = datetime('now') WHERE id = ?"
        )
        .bind(planItemId),
      db
        .prepare(
          `UPDATE daily_plans SET completed_items = completed_items + 1
           WHERE id = (SELECT plan_id FROM plan_items WHERE id = ?)`
        )
        .bind(planItemId)
    );
  }

  await db.batch(statements);

  // Update material using spaced repetition
  await updateMaterialAfterPractice(db, materialId, {
    completedAllStages,
    selfRating,
    isPoorPerformance,
  }, today);

  // Update user streak
  await updateUserStreak(db, userId, today);

  return recordId;
}

async function updateUserStreak(
  db: D1Database,
  userId: string,
  today: string
): Promise<void> {
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

  let newStreak: number;
  if (user.last_practice_date === yesterdayStr) {
    newStreak = user.streak_days + 1;
  } else {
    newStreak = 1;
  }

  const newMax = Math.max(newStreak, user.max_streak_days);
  const newTotal = user.total_practice_days + 1;

  await db
    .prepare(
      `UPDATE users SET
        last_practice_date = ?,
        streak_days = ?,
        max_streak_days = ?,
        total_practice_days = ?
       WHERE id = ?`
    )
    .bind(today, newStreak, newMax, newTotal, userId)
    .run();
}
