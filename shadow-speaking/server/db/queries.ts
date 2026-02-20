// --- Material Queries ---

export interface Material {
  id: string;
  user_id: string;
  content: string;
  source_type: string;
  level: number;
  status: string;
  tags: string;
  translation: string | null;
  phonetic_notes: string | null;
  pause_marks: string | null;
  word_mask: string | null;
  expression_prompt: string | null;
  audio_slow_key: string | null;
  audio_normal_key: string | null;
  audio_fast_key: string | null;
  review_count: number;
  next_review_date: string | null;
  last_practice_date: string | null;
  preprocess_status: string;
  created_at: string;
}

export async function createMaterial(
  db: D1Database,
  userId: string,
  content: string,
  sourceType: string = "direct"
): Promise<string> {
  const id = crypto.randomUUID();
  await db
    .prepare(
      "INSERT INTO materials (id, user_id, content, source_type) VALUES (?, ?, ?, ?)"
    )
    .bind(id, userId, content, sourceType)
    .run();
  return id;
}

export async function createMaterialsBatch(
  db: D1Database,
  userId: string,
  sentences: string[]
): Promise<string[]> {
  const ids = sentences.map(() => crypto.randomUUID());
  const statements = sentences.map((content, i) =>
    db
      .prepare(
        "INSERT INTO materials (id, user_id, content, source_type) VALUES (?, ?, ?, 'direct')"
      )
      .bind(ids[i], userId, content)
  );
  await db.batch(statements);
  return ids;
}

export async function getMaterial(
  db: D1Database,
  materialId: string
): Promise<Material | null> {
  return db
    .prepare("SELECT * FROM materials WHERE id = ?")
    .bind(materialId)
    .first<Material>();
}

export async function getUserMaterials(
  db: D1Database,
  userId: string,
  options: {
    status?: string;
    level?: number;
    search?: string;
    limit?: number;
    offset?: number;
  } = {}
): Promise<{ materials: Material[]; total: number }> {
  const { status, level, search, limit = 20, offset = 0 } = options;

  let whereClause = "WHERE user_id = ?";
  const params: (string | number)[] = [userId];

  if (status) {
    whereClause += " AND status = ?";
    params.push(status);
  }

  if (level) {
    whereClause += " AND level = ?";
    params.push(level);
  }

  if (search) {
    // Escape LIKE wildcards in user input
    const escaped = search.replace(/[%_\\]/g, "\\$&");
    whereClause += " AND content LIKE ? ESCAPE '\\'";
    params.push(`%${escaped}%`);
  }

  // Batch count and data queries for parallel execution
  const countStmt = db
    .prepare(`SELECT COUNT(*) as count FROM materials ${whereClause}`)
    .bind(...params);

  const dataStmt = db
    .prepare(
      `SELECT * FROM materials ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    )
    .bind(...params, limit, offset);

  const [countResult, materials] = await db.batch([countStmt, dataStmt]);

  const total = (countResult.results[0] as { count: number } | undefined)?.count || 0;

  return { materials: materials.results as unknown as Material[], total };
}

export async function deleteMaterial(
  db: D1Database,
  materialId: string,
  userId: string,
  r2: R2Bucket
): Promise<boolean> {
  // Read R2 keys before deleting rows
  const material = await db
    .prepare("SELECT audio_slow_key, audio_normal_key, audio_fast_key FROM materials WHERE id = ? AND user_id = ?")
    .bind(materialId, userId)
    .first<{ audio_slow_key: string | null; audio_normal_key: string | null; audio_fast_key: string | null }>();

  if (!material) return false;

  // Get recording R2 keys for this material
  const recordings = await db
    .prepare("SELECT r2_key FROM recordings WHERE material_id = ?")
    .bind(materialId)
    .all<{ r2_key: string }>();

  // Track how many plan items (total and completed) will be removed per plan
  const planItemCounts = await db
    .prepare(
      `SELECT plan_id,
              COUNT(*) as total_count,
              SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_count
       FROM plan_items WHERE material_id = ? GROUP BY plan_id`
    )
    .bind(materialId)
    .all<{ plan_id: string; total_count: number; completed_count: number }>();

  // Delete R2 objects (audio files + recordings)
  const r2Keys = [
    material.audio_slow_key,
    material.audio_normal_key,
    material.audio_fast_key,
    ...recordings.results.map((r) => r.r2_key),
  ].filter((k): k is string => !!k);

  if (r2Keys.length > 0) {
    await r2.delete(r2Keys);
  }

  // Cascade delete dependent rows + material in a batch
  const statements: D1PreparedStatement[] = planItemCounts.results.map(({ plan_id, total_count, completed_count }) =>
    db
      .prepare(
        `UPDATE daily_plans
         SET total_items = CASE WHEN total_items >= ? THEN total_items - ? ELSE 0 END,
             completed_items = CASE WHEN completed_items >= ? THEN completed_items - ? ELSE 0 END
         WHERE id = ?`
      )
      .bind(total_count, total_count, completed_count, completed_count, plan_id)
  );

  statements.push(
    db.prepare("DELETE FROM recordings WHERE material_id = ?").bind(materialId),
    db.prepare("DELETE FROM practice_records WHERE material_id = ?").bind(materialId),
    db.prepare("DELETE FROM plan_items WHERE material_id = ?").bind(materialId),
    db.prepare("DELETE FROM materials WHERE id = ? AND user_id = ?").bind(materialId, userId)
  );

  await db.batch(statements);

  return true;
}

export async function updateMaterialTags(
  db: D1Database,
  materialId: string,
  userId: string,
  tags: string[]
): Promise<boolean> {
  const result = await db
    .prepare(
      "UPDATE materials SET tags = ? WHERE id = ? AND user_id = ?"
    )
    .bind(JSON.stringify(tags), materialId, userId)
    .run();
  return result.meta.changes > 0;
}

// --- User Queries ---

export interface User {
  id: string;
  username: string;
  level: number;
  daily_minutes: number;
  streak_days: number;
  max_streak_days: number;
  total_practice_days: number;
  last_practice_date: string | null;
  onboarding_completed: number;
  created_at: string;
}

export async function getUser(
  db: D1Database,
  userId: string
): Promise<User | null> {
  return db
    .prepare(
      "SELECT id, username, level, daily_minutes, streak_days, max_streak_days, total_practice_days, last_practice_date, onboarding_completed, created_at FROM users WHERE id = ?"
    )
    .bind(userId)
    .first<User>();
}

export async function updateUserSettings(
  db: D1Database,
  userId: string,
  settings: { daily_minutes?: number; level?: number }
): Promise<void> {
  const updates: string[] = [];
  const values: (string | number)[] = [];

  if (settings.daily_minutes !== undefined) {
    updates.push("daily_minutes = ?");
    values.push(settings.daily_minutes);
  }

  if (settings.level !== undefined) {
    updates.push("level = ?");
    values.push(settings.level);
  }

  if (updates.length === 0) return;

  values.push(userId);
  await db
    .prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`)
    .bind(...values)
    .run();
}

// --- Daily Plan Queries ---

export interface DailyPlan {
  id: string;
  user_id: string;
  plan_date: string;
  total_items: number;
  completed_items: number;
  created_at: string;
}

export interface PlanItem {
  id: string;
  plan_id: string;
  material_id: string;
  item_order: number;
  item_type: string;
  status: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface PlanItemWithMaterial {
  // From plan_items
  id: string;
  plan_id: string;
  material_id: string;
  item_order: number;
  item_type: string;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  // From materials (aliased or selected)
  content: string;
  level: number;
  material_status: string;
  translation: string | null;
  tags: string;
  audio_slow_key: string | null;
  audio_normal_key: string | null;
  audio_fast_key: string | null;
  phonetic_notes: string | null;
  pause_marks: string | null;
  word_mask: string | null;
  expression_prompt: string | null;
  preprocess_status: string;
}

export async function getTodayPlan(
  db: D1Database,
  userId: string,
  date: string
): Promise<{ plan: DailyPlan | null; items: PlanItemWithMaterial[] }> {
  const plan = await db
    .prepare(
      "SELECT * FROM daily_plans WHERE user_id = ? AND plan_date = ?"
    )
    .bind(userId, date)
    .first<DailyPlan>();

  if (!plan) {
    return { plan: null, items: [] };
  }

  const items = await db
    .prepare(
      `SELECT pi.*, m.content, m.level, m.status as material_status, m.translation,
              m.tags, m.audio_slow_key, m.audio_normal_key, m.audio_fast_key,
              m.phonetic_notes, m.pause_marks, m.word_mask, m.expression_prompt,
              m.preprocess_status
       FROM plan_items pi
       JOIN materials m ON pi.material_id = m.id
       WHERE pi.plan_id = ?
       ORDER BY pi.item_order ASC`
    )
    .bind(plan.id)
    .all<PlanItemWithMaterial>();

  return { plan, items: items.results };
}

// --- Practice Record Queries ---

export interface PracticeRecord {
  id: string;
  user_id: string;
  material_id: string;
  plan_item_id: string | null;
  completed_all_stages: number;
  self_rating: string | null;
  is_poor_performance: number;
  duration_seconds: number;
  created_at: string;
}

export async function createPracticeRecord(
  db: D1Database,
  record: {
    userId: string;
    materialId: string;
    planItemId?: string;
    completedAllStages: boolean;
    selfRating?: string;
    isPoorPerformance: boolean;
    durationSeconds: number;
  }
): Promise<string> {
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO practice_records
       (id, user_id, material_id, plan_item_id, completed_all_stages, self_rating, is_poor_performance, duration_seconds)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      record.userId,
      record.materialId,
      record.planItemId || null,
      record.completedAllStages ? 1 : 0,
      record.selfRating || null,
      record.isPoorPerformance ? 1 : 0,
      record.durationSeconds
    )
    .run();
  return id;
}

// --- Recording Queries ---

export interface Recording {
  id: string;
  practice_record_id: string;
  material_id: string;
  stage: number;
  round: number;
  r2_key: string;
  duration_ms: number;
  is_silent: number;
  created_at: string;
}

export async function createRecording(
  db: D1Database,
  recording: {
    practiceRecordId: string;
    materialId: string;
    stage: number;
    round: number;
    r2Key: string;
    durationMs: number;
    isSilent: boolean;
  }
): Promise<string> {
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO recordings
       (id, practice_record_id, material_id, stage, round, r2_key, duration_ms, is_silent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      recording.practiceRecordId,
      recording.materialId,
      recording.stage,
      recording.round,
      recording.r2Key,
      recording.durationMs,
      recording.isSilent ? 1 : 0
    )
    .run();
  return id;
}

export async function getMaterialRecordings(
  db: D1Database,
  materialId: string
): Promise<Recording[]> {
  const result = await db
    .prepare(
      "SELECT * FROM recordings WHERE material_id = ? ORDER BY created_at DESC"
    )
    .bind(materialId)
    .all<Recording>();
  return result.results;
}

// --- Stats Queries ---

export async function getUserMaterialStats(
  db: D1Database,
  userId: string
): Promise<{
  total: number;
  unlearned: number;
  learning: number;
  mastered: number;
  byLevel: Record<number, { total: number; mastered: number }>;
}> {
  // Batch both queries for parallel execution
  const statusStmt = db
    .prepare(
      "SELECT status, COUNT(*) as count FROM materials WHERE user_id = ? GROUP BY status"
    )
    .bind(userId);

  const levelStmt = db
    .prepare(
      "SELECT level, status, COUNT(*) as count FROM materials WHERE user_id = ? GROUP BY level, status"
    )
    .bind(userId);

  const [statusResult, levelResult] = await db.batch([statusStmt, levelStmt]);

  const statusCounts = statusResult.results as { status: string; count: number }[];
  const levelCounts = levelResult.results as { level: number; status: string; count: number }[];

  let total = 0;
  let unlearned = 0;
  let learning = 0;
  let mastered = 0;

  for (const row of statusCounts) {
    total += row.count;
    if (row.status === "unlearned") unlearned = row.count;
    if (row.status === "learning") learning = row.count;
    if (row.status === "mastered") mastered = row.count;
  }

  const byLevel: Record<number, { total: number; mastered: number }> = {};
  for (const row of levelCounts) {
    if (!byLevel[row.level]) {
      byLevel[row.level] = { total: 0, mastered: 0 };
    }
    byLevel[row.level].total += row.count;
    if (row.status === "mastered") {
      byLevel[row.level].mastered = row.count;
    }
  }

  return { total, unlearned, learning, mastered, byLevel };
}
