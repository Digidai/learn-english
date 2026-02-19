import { useState } from "react";
import { Link, useLoaderData, Form, redirect, useNavigation } from "react-router";
import { requireAuth } from "~/lib/auth.server";
import { getMaterial, getMaterialRecordings, deleteMaterial } from "../../server/db/queries";
import { preprocessMaterial } from "../../server/services/minimax";
import { LEVEL_LABELS, type Level } from "~/lib/constants";
import type { Material, Recording } from "../../server/db/queries";
import type { Route } from "./+types/_app.corpus.$id";

export function meta() {
  return [{ title: "语料详情 - Shadow Speaking" }];
}

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const user = await requireAuth(request, env);
  const materialId = params.id!;

  const material = await getMaterial(env.DB, materialId);
  if (!material || material.user_id !== user.id) {
    throw redirect("/corpus");
  }

  const recordings = await getMaterialRecordings(env.DB, materialId);

  return { material, recordings };
}

export async function action({ params, request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const user = await requireAuth(request, env);
  const formData = await request.formData();
  const intent = String(formData.get("intent"));

  if (intent === "delete") {
    await deleteMaterial(env.DB, params.id!, user.id);
    return redirect("/corpus");
  }

  if (intent === "retry") {
    const material = await getMaterial(env.DB, params.id!);
    if (!material || material.user_id !== user.id) {
      return redirect("/corpus");
    }

    // CAS: only retry if currently failed (prevents concurrent retries)
    const updated = await env.DB.prepare(
      "UPDATE materials SET preprocess_status = 'pending' WHERE id = ? AND user_id = ? AND preprocess_status = 'failed'"
    ).bind(params.id!, user.id).run();

    if (updated.meta.changes === 0) {
      // Already retrying or not in failed state
      return { retryStarted: false };
    }

    // Re-trigger preprocessing via waitUntil
    const apiKey = env.MINIMAX_API_KEY;
    if (apiKey) {
      context.cloudflare.ctx.waitUntil(
        preprocessMaterial(apiKey, material.content, params.id!, user.id, env.DB, env.R2)
      );
    }

    return { retryStarted: true };
  }

  return null;
}

function safeJsonParse<T>(json: string | null, fallback: T): T {
  if (!json) return fallback;
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

export default function CorpusDetailPage() {
  const { material, recordings } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  const submittingIntent = isSubmitting
    ? new URLSearchParams(navigation.formData as any).get("intent")
    : null;
  const isDeleting = submittingIntent === "delete";
  const isRetrying = submittingIntent === "retry";
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const m = material as unknown as Material;
  const recs = recordings as unknown as Recording[];

  const tags = safeJsonParse<string[]>(m.tags, []);
  const phoneticNotes = safeJsonParse<Array<{ original: string; pronunciation: string }>>(
    m.phonetic_notes,
    []
  );

  const statusLabels: Record<string, string> = {
    unlearned: "未学习",
    learning: "学习中",
    mastered: "已掌握",
  };

  const stageLabels: Record<number, string> = {
    3: "同步跟读",
    4: "影子跟读",
    5: "脱稿复述",
    6: "自由表达",
  };

  return (
    <div>
      {/* Back link */}
      <Link to="/corpus" className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 mb-4">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
        </svg>
        返回语料库
      </Link>

      {/* Main content */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-4">
        <p className="text-xl font-medium text-gray-900 leading-relaxed mb-3">
          {m.content}
        </p>

        {m.translation && (
          <p className="text-gray-500 mb-4">{m.translation}</p>
        )}

        <div className="flex items-center gap-2 flex-wrap mb-4">
          <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-600">
            {statusLabels[m.status] || m.status}
          </span>
          <span className="text-xs text-gray-400">
            {LEVEL_LABELS[m.level as Level] || `L${m.level}`}
          </span>
          {tags.map((tag) => (
            <span key={tag} className="text-xs px-2 py-0.5 bg-gray-50 text-gray-500 rounded-full">
              {tag}
            </span>
          ))}
        </div>

        {/* Preprocessing failed — retry button */}
        {m.preprocess_status === "failed" && (
          <Form method="post" className="mb-4">
            <input type="hidden" name="intent" value="retry" />
            <button
              type="submit"
              disabled={isRetrying}
              className="w-full py-2.5 text-amber-700 border border-amber-300 rounded-xl hover:bg-amber-50 font-medium text-sm transition-colors disabled:opacity-50"
            >
              {isRetrying ? "处理中..." : "重新处理"}
            </button>
          </Form>
        )}
        {m.preprocess_status === "pending" && (
          <div className="mb-4 flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3">
            <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-blue-600">正在处理中，请稍候...</span>
          </div>
        )}

        {/* Phonetic notes */}
        {phoneticNotes.length > 0 && (
          <div className="bg-amber-50 rounded-xl p-4 mb-4">
            <p className="text-xs text-amber-600 font-medium mb-2">语音现象</p>
            <div className="space-y-1">
              {phoneticNotes.map((note, i) => (
                <p key={i} className="text-sm">
                  <span className="text-gray-600">{note.original}</span>
                  <span className="text-gray-400"> → </span>
                  <span className="text-amber-700">{note.pronunciation}</span>
                </p>
              ))}
            </div>
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 text-center">
          <div>
            <p className="text-lg font-semibold text-gray-900">{m.review_count}</p>
            <p className="text-xs text-gray-400">已复习</p>
          </div>
          <div>
            <p className="text-lg font-semibold text-gray-900">
              {m.next_review_date || "—"}
            </p>
            <p className="text-xs text-gray-400">下次复习</p>
          </div>
          <div>
            <p className="text-lg font-semibold text-gray-900">
              {m.last_practice_date || "—"}
            </p>
            <p className="text-xs text-gray-400">上次练习</p>
          </div>
        </div>
      </div>

      {/* Audio playback */}
      {m.audio_normal_key && (
        <div className="bg-white rounded-2xl border border-gray-200 p-4 mb-4">
          <p className="text-sm font-medium text-gray-500 mb-3">TTS 音频</p>
          <div className="space-y-2">
            {m.audio_slow_key && (
              <audio
                src={`/api/audio/${encodeURIComponent(m.audio_slow_key)}`}
                controls
                className="w-full h-10"
              />
            )}
            <p className="text-xs text-gray-400">慢速 / 常速 / 快速</p>
          </div>
        </div>
      )}

      {/* Recording history */}
      {recs.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 p-4 mb-4">
          <p className="text-sm font-medium text-gray-500 mb-3">
            练习录音 ({recs.length})
          </p>
          <div className="space-y-3">
            {recs.map((rec) => (
              <div key={rec.id} className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-700">
                    {stageLabels[rec.stage] || `阶段${rec.stage}`}
                    {rec.round > 1 && ` · 第${rec.round}轮`}
                  </p>
                  <p className="text-xs text-gray-400">
                    {new Date(rec.created_at).toLocaleDateString("zh-CN")} ·{" "}
                    {(rec.duration_ms / 1000).toFixed(1)}s
                  </p>
                </div>
                <audio
                  src={`/api/audio/${encodeURIComponent(rec.r2_key)}`}
                  controls
                  className="h-8 w-40"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Delete */}
      <button
        type="button"
        disabled={isDeleting}
        onClick={() => setShowDeleteConfirm(true)}
        className="w-full py-2.5 text-red-600 border border-red-200 rounded-xl hover:bg-red-50 disabled:opacity-50 transition-colors"
      >
        删除语料
      </button>

      {/* Delete confirmation modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">确认删除</h3>
            <p className="text-sm text-gray-500 mb-6">
              确定要删除这条语料吗？此操作不可撤销。
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 py-2.5 text-gray-700 border border-gray-200 rounded-xl hover:bg-gray-50 font-medium"
              >
                取消
              </button>
              <Form method="post" className="flex-1">
                <input type="hidden" name="intent" value="delete" />
                <button
                  type="submit"
                  className="w-full py-2.5 text-white bg-red-600 rounded-xl hover:bg-red-700 font-medium"
                >
                  删除
                </button>
              </Form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
