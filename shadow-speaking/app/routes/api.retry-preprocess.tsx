import { preprocessMaterial } from "../../server/services/minimax";
import type { Route } from "./+types/api.retry-preprocess";

export async function loader({ context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const apiKey = env.MINIMAX_API_KEY;

  if (!apiKey) {
    return Response.json({ error: "No API key configured" }, { status: 500 });
  }

  // Reset failed materials to pending so CAS works
  await env.DB.prepare(
    "UPDATE materials SET preprocess_status = 'pending' WHERE preprocess_status IN ('failed', 'processing')"
  ).run();

  // Get all pending materials
  const materials = await env.DB.prepare(
    `SELECT id, content, user_id FROM materials
     WHERE preprocess_status = 'pending'
     LIMIT 30`
  ).all<{ id: string; content: string; user_id: string }>();

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
          await preprocessMaterial(apiKey, m.content, m.id, m.user_id, env.DB, env.R2);
          const check = await env.DB.prepare(
            "SELECT preprocess_status FROM materials WHERE id = ?"
          ).bind(m.id).first<{ preprocess_status: string }>();
          if (check?.preprocess_status !== "done") {
            throw new Error(`status=${check?.preprocess_status}`);
          }
        } catch (e) {
          throw new Error(`${m.id.slice(0, 8)}: ${e instanceof Error ? e.message : String(e)}`);
        }
      })
    );
    for (const r of results) {
      if (r.status === "fulfilled") processed++;
      else errors.push(r.reason?.message || "unknown");
    }
  }

  return Response.json({ total: materials.results.length, processed, errors });
}
