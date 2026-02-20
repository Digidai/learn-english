import { useNavigate, useLoaderData, useSubmit, redirect, Link, useRouteError, isRouteErrorResponse } from "react-router";
import { requireAuth } from "~/lib/auth.server";
import { handlePracticeComplete } from "../../server/api/practice";
import { PracticeFlow } from "~/components/practice/PracticeFlow";
import type { Route } from "./+types/_app.today.$planItemId";

export function meta() {
  return [{ title: "练习 - Shadow Speaking" }];
}

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const user = await requireAuth(request, env);
  const planItemId = params.planItemId;

  // Get plan item and associated material with ownership check via JOIN
  const planItem = await env.DB.prepare(
    `SELECT pi.id as plan_item_id, pi.item_type, pi.status as item_status,
            m.id as material_id, m.content, m.translation, m.level,
            m.phonetic_notes, m.pause_marks, m.word_mask, m.expression_prompt,
            m.audio_slow_key, m.audio_normal_key, m.audio_fast_key,
            m.status, m.review_count
     FROM plan_items pi
     JOIN materials m ON pi.material_id = m.id
     JOIN daily_plans dp ON pi.plan_id = dp.id
     WHERE pi.id = ? AND dp.user_id = ?`
  )
    .bind(planItemId, user.id)
    .first();

  if (!planItem) {
    throw redirect("/today");
  }

  // Block re-practice of completed items
  if ((planItem as Record<string, unknown>).item_status === "completed") {
    throw redirect("/today?notice=completed");
  }

  return { material: planItem, planItemId };
}

export async function action({ request, context }: Route.ActionArgs) {
  try {
    const env = context.cloudflare.env;
    const user = await requireAuth(request, env);
    const formData = await request.formData();

    const materialId = String(formData.get("materialId"));
    const planItemId = String(formData.get("planItemId"));
    const selfRating = formData.get("selfRating") as string | null;
    const isPoorPerformance = formData.get("isPoorPerformance") === "true";
    const completedAllStages = formData.get("completedAllStages") !== "false";
    const durationSeconds = Number(formData.get("durationSeconds") || 0);

    // Validate ownership via JOIN (single query instead of two)
    const valid = await env.DB.prepare(
      `SELECT pi.id FROM plan_items pi
       JOIN daily_plans dp ON pi.plan_id = dp.id
       JOIN materials m ON pi.material_id = m.id
       WHERE pi.id = ? AND dp.user_id = ? AND m.id = ? AND m.user_id = ?`
    )
      .bind(planItemId, user.id, materialId, user.id)
      .first();

    if (!valid) {
      return redirect("/today");
    }

    // Use handlePracticeComplete which includes spaced repetition + streak updates
    const recordId = await handlePracticeComplete(
      env.DB,
      user.id,
      materialId,
      planItemId,
      selfRating,
      isPoorPerformance,
      durationSeconds,
      completedAllStages
    );

    // Upload recordings to R2 in parallel, then batch-insert DB rows
    const recordingEntries = formData.getAll("recordingKey");
    const recordingBlobs = formData.getAll("recordingBlob");
    const recordingMimeTypes = formData.getAll("recordingMime");

    // Build upload tasks: parse key first, skip unparseable ones
    const uploads: Array<{ key: string; blob: File; stage: number; round: number; mime: string }> = [];
    for (let i = 0; i < recordingEntries.length; i++) {
      const key = String(recordingEntries[i]);
      const blob = recordingBlobs[i];
      if (!(blob instanceof File) || blob.size === 0) continue;

      // Parse key format: "stage4-round2-timestamp" → stage=4, round=2
      const match = key.match(/^stage(\d+)(?:-round(\d+))?/);
      if (!match) continue;
      const mime = String(recordingMimeTypes[i] || blob.type || "audio/webm;codecs=opus");
      uploads.push({
        key,
        blob,
        stage: parseInt(match[1], 10),
        round: match[2] ? parseInt(match[2], 10) : 1,
        mime,
      });
    }

    if (uploads.length > 0) {
      // Determine file extension from MIME type
      const extFromMime = (mime: string) => {
        if (mime.includes("mp4")) return "m4a";
        if (mime.includes("webm")) return "webm";
        return "webm";
      };

      // R2 uploads in parallel with allSettled (partial failure tolerance)
      const results = await Promise.allSettled(
        uploads.map(async ({ key, blob, mime }) => {
          const ext = extFromMime(mime);
          const r2Key = `recordings/${user.id}/${materialId}/${key}.${ext}`;
          await env.R2.put(r2Key, blob.stream(), {
            httpMetadata: { contentType: mime },
          });
          return r2Key;
        })
      );

      // Batch-insert DB rows only for successful uploads
      const dbInserts: Array<{ stage: number; round: number; r2Key: string }> = [];
      results.forEach((result, i) => {
        if (result.status === "fulfilled") {
          dbInserts.push({
            stage: uploads[i].stage,
            round: uploads[i].round,
            r2Key: result.value,
          });
        }
      });

      if (dbInserts.length > 0) {
        await env.DB.batch(
          dbInserts.map(({ stage, round, r2Key }) =>
            env.DB.prepare(
              `INSERT INTO recordings (id, practice_record_id, material_id, stage, round, r2_key, duration_ms)
               VALUES (?, ?, ?, ?, ?, ?, 0)`
            ).bind(crypto.randomUUID(), recordId, materialId, stage, round, r2Key)
          )
        );
      }
    }

    return redirect("/today");
  } catch (error) {
    if (error instanceof Response) {
      throw error;
    }

    console.error("[PracticeDetailAction] Failed to complete practice", error);
    return redirect("/today");
  }
}

export function ErrorBoundary() {
  const error = useRouteError();
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4">
      <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mb-4">
        <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
        </svg>
      </div>
      <h2 className="text-lg font-semibold text-gray-900 mb-2">练习加载失败</h2>
      <p className="text-sm text-gray-500 mb-4">请稍后再试</p>
      {import.meta.env.DEV && (
        <pre className="text-xs text-red-600 bg-red-50 rounded-lg p-3 mb-4 max-w-full overflow-auto">
          {isRouteErrorResponse(error)
            ? `${error.status} ${error.statusText}`
            : error instanceof Error
              ? error.message
              : "Unknown error"}
        </pre>
      )}
      <Link
        to="/today"
        className="px-6 py-2.5 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors"
      >
        返回今日计划
      </Link>
    </div>
  );
}

interface PracticeMaterial {
  plan_item_id: string;
  material_id: string;
  content: string;
  translation: string | null;
  level: number;
  phonetic_notes: string | null;
  pause_marks: string | null;
  word_mask: string | null;
  expression_prompt: string | null;
  audio_slow_key: string | null;
  audio_normal_key: string | null;
  audio_fast_key: string | null;
  status: string;
  review_count: number;
}

export default function PracticeDetailPage() {
  const { material, planItemId } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const submit = useSubmit();

  const raw = material as unknown as PracticeMaterial;
  const m = { ...raw, id: raw.material_id };

  const handleComplete = (data: {
    selfRating: string | null;
    isPoorPerformance: boolean;
    durationSeconds: number;
    completedAllStages: boolean;
    recordings: Map<string, Blob>;
  }) => {
    const formData = new FormData();
    formData.set("materialId", m.material_id);
    formData.set("planItemId", planItemId);
    formData.set("selfRating", data.selfRating || "");
    formData.set("isPoorPerformance", String(data.isPoorPerformance));
    formData.set("completedAllStages", String(data.completedAllStages));
    formData.set("durationSeconds", String(data.durationSeconds));

    // Attach recordings with MIME type info
    data.recordings.forEach((blob, key) => {
      const ext = blob.type.includes("mp4") ? "m4a" : "webm";
      formData.append("recordingKey", key);
      formData.append("recordingBlob", blob, `${key}.${ext}`);
      formData.append("recordingMime", blob.type || "audio/webm;codecs=opus");
    });

    submit(formData, { method: "post", encType: "multipart/form-data" });
  };

  const handleExit = () => {
    navigate("/today");
  };

  return (
    <PracticeFlow
      material={m}
      onComplete={handleComplete}
      onExit={handleExit}
    />
  );
}
