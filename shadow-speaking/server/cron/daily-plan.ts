import { generateDailyPlan } from "../services/plan-generator";
import { preprocessMaterial } from "../services/minimax";
import { checkPracticeDataIntegrity } from "../services/data-integrity";

const CONCURRENCY_LIMIT = 10;
let hasPreprocessJobsTable = false;

async function ensurePreprocessJobsTable(db: D1Database): Promise<void> {
  if (hasPreprocessJobsTable) return;
  await db.exec(
    `CREATE TABLE IF NOT EXISTS preprocess_jobs (
      material_id TEXT PRIMARY KEY,
      started_at INTEGER NOT NULL
    )`
  );
  hasPreprocessJobsTable = true;
}

export async function handleDailyPlanCron(env: Env): Promise<void> {
  // Use UTC+8 (China time) consistently — cron runs at UTC 20:00 = Beijing 04:00 next day
  const now = new Date();
  const chinaOffset = 8 * 60 * 60 * 1000;
  const planDate = new Date(now.getTime() + chinaOffset).toISOString().slice(0, 10);

  console.log(`[Cron] Generating daily plans for ${planDate}`);

  // Recovery: reset materials tracked as 'processing' for > 5 minutes back to 'pending'
  await ensurePreprocessJobsTable(env.DB);
  const staleThreshold = Math.floor(Date.now() / 1000) - 5 * 60;
  const staleJobs = await env.DB.prepare(
    "SELECT material_id FROM preprocess_jobs WHERE started_at <= ? LIMIT 100"
  )
    .bind(staleThreshold)
    .all<{ material_id: string }>();

  if (staleJobs.results.length > 0) {
    const resetStatements: D1PreparedStatement[] = [];
    for (const job of staleJobs.results) {
      resetStatements.push(
        env.DB
          .prepare(
            "UPDATE materials SET preprocess_status = 'pending' WHERE id = ? AND preprocess_status = 'processing'"
          )
          .bind(job.material_id),
        env.DB
          .prepare("DELETE FROM preprocess_jobs WHERE material_id = ?")
          .bind(job.material_id)
      );
    }
    await env.DB.batch(resetStatements);
    console.log(`[Cron] Reset ${staleJobs.results.length} stale processing jobs`);
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

  // Run a lightweight integrity audit after cron work
  try {
    const issues = await checkPracticeDataIntegrity(env.DB, 15);
    if (issues.length === 0) {
      console.log(
        JSON.stringify({
          ts: new Date().toISOString(),
          scope: "integrity",
          event: "practice_audit_passed",
          severity: "info",
        })
      );
      return;
    }

    for (const issue of issues) {
      const payload = {
        ts: new Date().toISOString(),
        scope: "integrity",
        event: "practice_audit_issue",
        code: issue.code,
        severity: issue.severity,
        count: issue.count,
        message: issue.message,
        samples: issue.samples,
      };
      if (issue.severity === "error") {
        console.error(JSON.stringify(payload));
      } else {
        console.warn(JSON.stringify(payload));
      }
    }
  } catch (auditError) {
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        scope: "integrity",
        event: "practice_audit_failed",
        severity: "error",
        error: auditError instanceof Error ? auditError.message : String(auditError),
      })
    );
  }
}
