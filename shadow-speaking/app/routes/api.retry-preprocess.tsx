import { requireAuth } from "~/lib/auth.server";
import { preprocessMaterial } from "../../server/services/minimax";
import type { Route } from "./+types/api.retry-preprocess";

const LOCK_KEY = "retry_preprocess";
const LOCK_TTL_SECONDS = 300;
const MAX_RETRY_BATCH = 30;

let hasOpsLockTable = false;

async function ensureOpsLockTable(db: D1Database): Promise<void> {
  if (hasOpsLockTable) return;
  await db.exec(
    `CREATE TABLE IF NOT EXISTS operation_locks (
      lock_key TEXT PRIMARY KEY,
      owner_token TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    )`
  );
  hasOpsLockTable = true;
}

function parseAdminUsers(rawValue: string | undefined): Set<string> {
  if (!rawValue) return new Set();
  return new Set(
    rawValue
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean)
  );
}

export async function loader() {
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { Allow: "POST" },
  });
}

export async function action({ request, context }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "POST" },
    });
  }

  const env = context.cloudflare.env;
  let user: { id: string; username: string };
  try {
    user = await requireAuth(request, env);
  } catch (error) {
    if (error instanceof Response) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw error;
  }
  const apiKey = env.MINIMAX_API_KEY;
  const adminUsers = parseAdminUsers(env.RETRY_PREPROCESS_ADMIN_USERS);

  if (!adminUsers.has(user.username)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!apiKey) {
    return Response.json({ error: "No API key configured" }, { status: 500 });
  }

  await ensureOpsLockTable(env.DB);
  const ownerToken = crypto.randomUUID();
  const nowTs = Math.floor(Date.now() / 1000);
  const expiresAt = nowTs + LOCK_TTL_SECONDS;

  // Clear expired lock row, then acquire lock via PK constraint (atomic on D1 side)
  await env.DB.prepare(
    "DELETE FROM operation_locks WHERE lock_key = ? AND expires_at <= ?"
  )
    .bind(LOCK_KEY, nowTs)
    .run();

  try {
    await env.DB.prepare(
      "INSERT INTO operation_locks (lock_key, owner_token, expires_at) VALUES (?, ?, ?)"
    )
      .bind(LOCK_KEY, ownerToken, expiresAt)
      .run();
  } catch {
    return Response.json(
      { error: "A retry task is already running. Please try again later." },
      { status: 429 }
    );
  }

  try {
    // Reset failed materials to pending so CAS works
    await env.DB.prepare(
      "UPDATE materials SET preprocess_status = 'pending' WHERE preprocess_status = 'failed'"
    ).run();

    // Get all pending materials
    const materials = await env.DB.prepare(
      `SELECT id, content, user_id FROM materials
     WHERE preprocess_status = 'pending'
     LIMIT ?`
    )
      .bind(MAX_RETRY_BATCH)
      .all<{ id: string; content: string; user_id: string }>();

    if (materials.results.length === 0) {
      return Response.json({ message: "No materials to process", count: 0 });
    }

    // Process in batches of 3
    const errors: string[] = [];
    let processed = 0;
    const BATCH_SIZE = 3;

    for (let i = 0; i < materials.results.length; i += BATCH_SIZE) {
      const batch = materials.results.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(async (m) => {
          try {
            await preprocessMaterial(
              apiKey,
              m.content,
              m.id,
              m.user_id,
              env.DB,
              env.R2
            );
            const check = await env.DB.prepare(
              "SELECT preprocess_status FROM materials WHERE id = ?"
            )
              .bind(m.id)
              .first<{ preprocess_status: string }>();
            if (check?.preprocess_status !== "done") {
              throw new Error(`status=${check?.preprocess_status}`);
            }
          } catch (e) {
            throw new Error(
              `${m.id.slice(0, 8)}: ${
                e instanceof Error ? e.message : String(e)
              }`
            );
          }
        })
      );
      for (const r of results) {
        if (r.status === "fulfilled") processed++;
        else errors.push(r.reason?.message || "unknown");
      }
    }

    return Response.json({ total: materials.results.length, processed, errors });
  } finally {
    await env.DB.prepare(
      "DELETE FROM operation_locks WHERE lock_key = ? AND owner_token = ?"
    )
      .bind(LOCK_KEY, ownerToken)
      .run();
  }
}
