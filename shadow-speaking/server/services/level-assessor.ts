export async function checkLevelProgression(
  db: D1Database,
  userId: string,
  currentLevel: number,
  today: string
): Promise<{ shouldUpgrade: boolean; inObservation: boolean }> {
  if (currentLevel >= 5) {
    return { shouldUpgrade: false, inObservation: false };
  }

  // Condition 1: >= 20 mastered materials at current level
  const masteredCount = await db
    .prepare(
      "SELECT COUNT(*) as count FROM materials WHERE user_id = ? AND level = ? AND status = 'mastered'"
    )
    .bind(userId, currentLevel)
    .first<{ count: number }>();

  if (!masteredCount || masteredCount.count < 20) {
    return { shouldUpgrade: false, inObservation: false };
  }

  // Condition 2: Last 7 days completion rate > 80% (exclude today)
  const recentPlans = await db
    .prepare(
      `SELECT plan_date, completed_items, total_items
       FROM daily_plans
       WHERE user_id = ? AND plan_date >= date(?, '-7 days') AND plan_date < ?
       ORDER BY plan_date DESC`
    )
    .bind(userId, today, today)
    .all<{ plan_date: string; completed_items: number; total_items: number }>();

  if (recentPlans.results.length < 3) {
    // Not enough data
    return { shouldUpgrade: false, inObservation: false };
  }

  const totalCompleted = recentPlans.results.reduce((s, p) => s + p.completed_items, 0);
  const totalItems = recentPlans.results.reduce((s, p) => s + p.total_items, 0);
  const completionRate = totalItems > 0 ? totalCompleted / totalItems : 0;

  if (completionRate <= 0.8) {
    return { shouldUpgrade: false, inObservation: false };
  }

  // All conditions met — promote the user
  return { shouldUpgrade: true, inObservation: false };
}

export async function checkRetirementProtection(
  db: D1Database,
  userId: string,
  today: string
): Promise<{ shouldReduceNew: boolean }> {
  // Check if last 3 days completion rate < 50% (exclude today)
  const recentPlans = await db
    .prepare(
      `SELECT completed_items, total_items
       FROM daily_plans
       WHERE user_id = ? AND plan_date >= date(?, '-3 days') AND plan_date < ?
       ORDER BY plan_date DESC`
    )
    .bind(userId, today, today)
    .all<{ completed_items: number; total_items: number }>();

  if (recentPlans.results.length < 3) {
    return { shouldReduceNew: false };
  }

  const allBelow50 = recentPlans.results.every(
    (p) => p.total_items > 0 && p.completed_items / p.total_items < 0.5
  );

  return { shouldReduceNew: allBelow50 };
}
