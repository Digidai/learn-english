import { generateDailyPlan } from "../services/plan-generator";
import { preprocessMaterial } from "../services/minimax";

const CONCURRENCY_LIMIT = 10;

export async function handleDailyPlanCron(env: Env): Promise<void> {
  // Use UTC+8 (China time) consistently — cron runs at UTC 20:00 = Beijing 04:00 next day
  const now = new Date();
  const chinaOffset = 8 * 60 * 60 * 1000;
  const planDate = new Date(now.getTime() + chinaOffset).toISOString().slice(0, 10);

  console.log(`[Cron] Generating daily plans for ${planDate}`);

  // Recovery: reset materials stuck in 'processing' for > 5 minutes back to 'pending'
  const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000).toISOString();
  const stuckReset = await env.DB.prepare(
    `UPDATE materials SET preprocess_status = 'pending'
     WHERE preprocess_status = 'processing'
     AND datetime(created_at) < datetime(?)`
  ).bind(fiveMinutesAgo).run();
  if (stuckReset.meta.changes > 0) {
    console.log(`[Cron] Reset ${stuckReset.meta.changes} stuck processing materials`);
  }

  // Retry pending/failed materials that were never processed
  const apiKey = env.MINIMAX_API_KEY;
  if (apiKey) {
    const staleMaterials = await env.DB.prepare(
      `SELECT m.id, m.content, m.user_id FROM materials m
       WHERE m.preprocess_status IN ('pending', 'failed')
       LIMIT 30`
    ).all<{ id: string; content: string; user_id: string }>();

    if (staleMaterials.results.length > 0) {
      console.log(`[Cron] Retrying ${staleMaterials.results.length} unprocessed materials`);
      const BATCH_SIZE = 3;
      for (let i = 0; i < staleMaterials.results.length; i += BATCH_SIZE) {
        const batch = staleMaterials.results.slice(i, i + BATCH_SIZE);
        await Promise.allSettled(
          batch.map((m) =>
            preprocessMaterial(apiKey, m.content, m.id, m.user_id, env.DB, env.R2)
          )
        );
      }
    }
  }

  // Get all users
  const users = await env.DB.prepare(
    "SELECT id, level, daily_minutes FROM users WHERE onboarding_completed = 1"
  ).all<{ id: string; level: number; daily_minutes: number }>();

  let generated = 0;
  let skipped = 0;

  // Process users in batches for concurrency (avoid sequential timeout)
  for (let i = 0; i < users.results.length; i += CONCURRENCY_LIMIT) {
    const batch = users.results.slice(i, i + CONCURRENCY_LIMIT);
    const results = await Promise.allSettled(
      batch.map(async (user) => {
        const result = await generateDailyPlan(env.DB, user, planDate);
        return result ? "generated" : "skipped";
      })
    );

    for (const result of results) {
      if (result.status === "fulfilled") {
        if (result.value === "generated") generated++;
        else skipped++;
      } else {
        console.error(`[Cron] Failed to generate plan:`, result.reason);
      }
    }
  }

  console.log(`[Cron] Plans generated: ${generated}, skipped: ${skipped}`);
}
