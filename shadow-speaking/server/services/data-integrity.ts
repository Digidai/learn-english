export interface DataIntegrityIssue {
  code:
    | "completed_items_over_total"
    | "plan_completion_mismatch"
    | "completed_plan_item_without_record"
    | "practice_record_plan_status_mismatch"
    | "duplicate_operation_id";
  severity: "warn" | "error";
  count: number;
  message: string;
  samples: string[];
}

interface CountRow {
  count: number;
}

async function queryCount(
  db: D1Database,
  sql: string,
  binds: Array<string | number> = []
): Promise<number> {
  const row = await db.prepare(sql).bind(...binds).first<CountRow>();
  return row?.count || 0;
}

export async function checkPracticeDataIntegrity(
  db: D1Database,
  sampleLimit: number = 10
): Promise<DataIntegrityIssue[]> {
  const limit = Math.max(1, Math.min(50, sampleLimit));
  const issues: DataIntegrityIssue[] = [];

  const overTotal = await queryCount(
    db,
    "SELECT COUNT(*) as count FROM daily_plans WHERE completed_items > total_items"
  );
  if (overTotal > 0) {
    const sampleRows = await db
      .prepare(
        "SELECT id FROM daily_plans WHERE completed_items > total_items LIMIT ?"
      )
      .bind(limit)
      .all<{ id: string }>();
    issues.push({
      code: "completed_items_over_total",
      severity: "error",
      count: overTotal,
      message: "daily_plans.completed_items exceeds total_items",
      samples: sampleRows.results.map((r) => r.id),
    });
  }

  const completionMismatch = await queryCount(
    db,
    `SELECT COUNT(*) as count
     FROM daily_plans dp
     WHERE dp.completed_items != (
       SELECT COUNT(*)
       FROM plan_items pi
       WHERE pi.plan_id = dp.id AND pi.status = 'completed'
     )`
  );
  if (completionMismatch > 0) {
    const sampleRows = await db
      .prepare(
        `SELECT dp.id
         FROM daily_plans dp
         WHERE dp.completed_items != (
           SELECT COUNT(*)
           FROM plan_items pi
           WHERE pi.plan_id = dp.id AND pi.status = 'completed'
         )
         LIMIT ?`
      )
      .bind(limit)
      .all<{ id: string }>();
    issues.push({
      code: "plan_completion_mismatch",
      severity: "error",
      count: completionMismatch,
      message: "daily_plans.completed_items mismatches completed plan_items count",
      samples: sampleRows.results.map((r) => r.id),
    });
  }

  const completedWithoutRecord = await queryCount(
    db,
    `SELECT COUNT(*) as count
     FROM plan_items pi
     LEFT JOIN practice_records pr ON pr.plan_item_id = pi.id
     WHERE pi.status = 'completed' AND pr.id IS NULL`
  );
  if (completedWithoutRecord > 0) {
    const sampleRows = await db
      .prepare(
        `SELECT pi.id
         FROM plan_items pi
         LEFT JOIN practice_records pr ON pr.plan_item_id = pi.id
         WHERE pi.status = 'completed' AND pr.id IS NULL
         LIMIT ?`
      )
      .bind(limit)
      .all<{ id: string }>();
    issues.push({
      code: "completed_plan_item_without_record",
      severity: "error",
      count: completedWithoutRecord,
      message: "completed plan_items without linked practice_records",
      samples: sampleRows.results.map((r) => r.id),
    });
  }

  const planStatusMismatch = await queryCount(
    db,
    `SELECT COUNT(*) as count
     FROM practice_records pr
     JOIN plan_items pi ON pr.plan_item_id = pi.id
     WHERE pi.status != 'completed'`
  );
  if (planStatusMismatch > 0) {
    const sampleRows = await db
      .prepare(
        `SELECT pr.id
         FROM practice_records pr
         JOIN plan_items pi ON pr.plan_item_id = pi.id
         WHERE pi.status != 'completed'
         LIMIT ?`
      )
      .bind(limit)
      .all<{ id: string }>();
    issues.push({
      code: "practice_record_plan_status_mismatch",
      severity: "warn",
      count: planStatusMismatch,
      message: "practice_records linked to non-completed plan_items",
      samples: sampleRows.results.map((r) => r.id),
    });
  }

  const duplicateOperationIds = await queryCount(
    db,
    `SELECT COUNT(*) as count FROM (
       SELECT user_id, operation_id, COUNT(*) as c
       FROM practice_records
       WHERE operation_id IS NOT NULL
       GROUP BY user_id, operation_id
       HAVING c > 1
     )`
  );
  if (duplicateOperationIds > 0) {
    const sampleRows = await db
      .prepare(
        `SELECT user_id, operation_id
         FROM practice_records
         WHERE operation_id IS NOT NULL
         GROUP BY user_id, operation_id
         HAVING COUNT(*) > 1
         LIMIT ?`
      )
      .bind(limit)
      .all<{ user_id: string; operation_id: string }>();
    issues.push({
      code: "duplicate_operation_id",
      severity: "error",
      count: duplicateOperationIds,
      message: "duplicate operation_id detected per user in practice_records",
      samples: sampleRows.results.map((r) => `${r.user_id}:${r.operation_id}`),
    });
  }

  return issues;
}
