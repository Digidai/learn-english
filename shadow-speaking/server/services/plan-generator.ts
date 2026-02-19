import { checkRetirementProtection } from "./level-assessor";

const MAX_PLAN_ITEMS = 50;

interface UserProfile {
  id: string;
  level: number;
  daily_minutes: number;
}

interface MaterialForPlan {
  id: string;
  level: number;
  status: string;
  tags: string;
  next_review_date: string | null;
  created_at: string;
}

export async function generateDailyPlan(
  db: D1Database,
  user: UserProfile,
  planDate: string
): Promise<{ planId: string; totalItems: number } | null> {
  // Check if plan already exists
  const existing = await db
    .prepare(
      "SELECT id FROM daily_plans WHERE user_id = ? AND plan_date = ?"
    )
    .bind(user.id, planDate)
    .first();

  if (existing) {
    return null; // Already exists
  }

  // Calculate total items: daily_minutes / 2, capped at MAX_PLAN_ITEMS
  const totalSlots = Math.min(Math.floor(user.daily_minutes / 2), MAX_PLAN_ITEMS);

  // Step 1: Get due review materials
  const reviewMaterials = await db
    .prepare(
      `SELECT id, level, status, tags, next_review_date, created_at
       FROM materials
       WHERE user_id = ?
         AND status = 'learning'
         AND next_review_date <= ?
         AND preprocess_status = 'done'
       ORDER BY next_review_date ASC`
    )
    .bind(user.id, planDate)
    .all<MaterialForPlan>();

  // Cap reviews to guarantee at least 1 new material slot (when totalSlots > 1)
  const reviewCap = totalSlots > 1
    ? Math.min(reviewMaterials.results.length, totalSlots - 1, Math.ceil(totalSlots * 0.8))
    : totalSlots;
  const reviewItems = reviewMaterials.results.slice(0, reviewCap);

  // Step 2: Calculate new material slots, applying retirement protection
  let newSlots = Math.max(0, totalSlots - reviewItems.length);
  if (newSlots > 0) {
    const { shouldReduceNew } = await checkRetirementProtection(db, user.id, planDate);
    if (shouldReduceNew) {
      newSlots = 0;
    }
  }

  // Step 3: Get new materials (level <= user_level, not +1)
  let newItems: MaterialForPlan[] = [];
  if (newSlots > 0) {
    const newMaterials = await db
      .prepare(
        `SELECT id, level, status, tags, next_review_date, created_at
         FROM materials
         WHERE user_id = ?
           AND status = 'unlearned'
           AND level <= ?
           AND preprocess_status = 'done'
         ORDER BY created_at ASC
         LIMIT ?`
      )
      .bind(user.id, user.level, newSlots)
      .all<MaterialForPlan>();

    newItems = newMaterials.results;
  }

  // Step 4: Sort
  // Review: by level ascending
  reviewItems.sort((a, b) => a.level - b.level);

  // New: group by tags then sort by level
  newItems.sort((a, b) => {
    const tagsA = a.tags || "[]";
    const tagsB = b.tags || "[]";
    if (tagsA !== tagsB) return tagsA.localeCompare(tagsB);
    return a.level - b.level;
  });

  const allItems = [...reviewItems, ...newItems];

  if (allItems.length === 0) {
    return null;
  }

  // Create plan and items in a batch for atomicity
  const planId = crypto.randomUUID();
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        "INSERT INTO daily_plans (id, user_id, plan_date, total_items) VALUES (?, ?, ?, ?)"
      )
      .bind(planId, user.id, planDate, allItems.length),
  ];

  for (let i = 0; i < allItems.length; i++) {
    const item = allItems[i];
    const itemType = item.status === "learning" ? "review" : "new";
    statements.push(
      db
        .prepare(
          "INSERT INTO plan_items (id, plan_id, material_id, item_order, item_type) VALUES (?, ?, ?, ?, ?)"
        )
        .bind(crypto.randomUUID(), planId, item.id, i + 1, itemType)
    );
  }

  try {
    await db.batch(statements);
  } catch (err) {
    // Unique constraint violation (TOCTOU race) — plan was already created concurrently
    if (err instanceof Error && err.message.includes("UNIQUE constraint failed")) {
      const existing = await db
        .prepare("SELECT id, total_items FROM daily_plans WHERE user_id = ? AND plan_date = ?")
        .bind(user.id, planDate)
        .first<{ id: string; total_items: number }>();
      if (existing) {
        return { planId: existing.id, totalItems: existing.total_items };
      }
      return null;
    }
    throw err;
  }

  return { planId, totalItems: allItems.length };
}

export async function regenerateDailyPlan(
  db: D1Database,
  user: UserProfile,
  planDate: string
): Promise<{ planId: string; totalItems: number } | null> {
  // Delete existing plan for today (only if no items completed)
  const existingPlan = await db
    .prepare(
      "SELECT id, completed_items FROM daily_plans WHERE user_id = ? AND plan_date = ?"
    )
    .bind(user.id, planDate)
    .first<{ id: string; completed_items: number }>();

  if (existingPlan) {
    // Check for any non-pending (in-progress or completed) items
    const nonPending = await db
      .prepare(
        "SELECT COUNT(*) as count FROM plan_items WHERE plan_id = ? AND status != 'pending'"
      )
      .bind(existingPlan.id)
      .first<{ count: number }>();

    if (nonPending && nonPending.count > 0) {
      // Don't regenerate if any items are in-progress or completed
      return null;
    }

    // Delete pending items and empty plan atomically
    await db.batch([
      db
        .prepare("DELETE FROM plan_items WHERE plan_id = ? AND status = 'pending'")
        .bind(existingPlan.id),
      db
        .prepare("DELETE FROM daily_plans WHERE id = ? AND completed_items = 0")
        .bind(existingPlan.id),
    ]);
  }

  return generateDailyPlan(db, user, planDate);
}
