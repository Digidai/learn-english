import { useState, useEffect, useRef } from "react";
import { Link, useLoaderData, Form, useNavigation, useSearchParams, useRevalidator, useActionData, data as json } from "react-router";
import { requireAuth } from "~/lib/auth.server";
import { getTodayPlan } from "../../server/db/queries";
import { generateDailyPlan } from "../../server/services/plan-generator";
import { preprocessMaterial } from "../../server/services/minimax";
import type { Route } from "./+types/_app.today";

export function meta() {
  return [{ title: "今日练习 - Shadow Speaking" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const user = await requireAuth(request, env);
  // Use UTC+8 (China time) for date consistency
  const now = new Date();
  const chinaOffset = 8 * 60 * 60 * 1000;
  const today = new Date(now.getTime() + chinaOffset).toISOString().slice(0, 10);

  // Try to get today's plan, generate if not exists
  let { plan, items } = await getTodayPlan(env.DB, user.id, today);

  if (!plan) {
    const result = await generateDailyPlan(env.DB, user, today);
    if (result) {
      const data = await getTodayPlan(env.DB, user.id, today);
      plan = data.plan;
      items = data.items;
    }
  }

  // Check if user has ANY materials at all (to distinguish empty states)
  const materialStats = await env.DB.prepare(
    "SELECT COUNT(*) as total, SUM(CASE WHEN preprocess_status != 'done' THEN 1 ELSE 0 END) as pending FROM materials WHERE user_id = ?"
  ).bind(user.id).first<{ total: number; pending: number }>();

  const hasAnyMaterials = (materialStats?.total || 0) > 0;
  const hasPendingMaterials = (materialStats?.pending || 0) > 0;

  // Auto-retry stale pending/failed materials that were never processed
  if (hasPendingMaterials) {
    const apiKey = env.MINIMAX_API_KEY;
    if (apiKey) {
      const oneMinAgo = new Date(now.getTime() - 60_000).toISOString();
      const staleMaterials = await env.DB.prepare(
        `SELECT id, content FROM materials
         WHERE user_id = ? AND preprocess_status IN ('pending', 'failed')
         AND created_at < ?
         LIMIT 15`
      ).bind(user.id, oneMinAgo).all<{ id: string; content: string }>();

      if (staleMaterials.results.length > 0) {
        context.cloudflare.ctx.waitUntil(
          (async () => {
            const BATCH_SIZE = 3;
            for (let i = 0; i < staleMaterials.results.length; i += BATCH_SIZE) {
              const batch = staleMaterials.results.slice(i, i + BATCH_SIZE);
              await Promise.allSettled(
                batch.map((m) =>
                  preprocessMaterial(apiKey, m.content, m.id, user.id, env.DB, env.R2)
                )
              );
            }
          })()
        );
      }
    }
  }

  return {
    plan,
    items,
    user,
    hasAnyMaterials,
    hasPendingMaterials,
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const user = await requireAuth(request, env);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "regenerate") {
    const now = new Date();
    const chinaOffset = 8 * 60 * 60 * 1000;
    const today = new Date(now.getTime() + chinaOffset).toISOString().slice(0, 10);
    const { regenerateDailyPlan } = await import("../../server/services/plan-generator");
    const result = await regenerateDailyPlan(env.DB, user, today);
    if (!result || ("blocked" in result && result.blocked)) {
      const reason = result && "blocked" in result
        ? result.reason
        : "已有进行中的练习，无法刷新计划";
      return json({ error: reason }, { status: 409 });
    }
    return json({ success: true });
  }

  return null;
}

export default function TodayPage() {
  const { plan, items, user, hasAnyMaterials, hasPendingMaterials } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const actionData = useActionData<typeof action>();
  const isRegenerating = navigation.state === "submitting";
  const [searchParams, setSearchParams] = useSearchParams();
  const [showRegenConfirm, setShowRegenConfirm] = useState(false);
  const regenDialogRef = useRef<HTMLDivElement>(null);
  const notice = searchParams.get("notice");

  // Focus trap + Escape for regen dialog
  useEffect(() => {
    if (!showRegenConfirm) return;
    const dialog = regenDialogRef.current;
    if (!dialog) return;

    const focusableButtons = dialog.querySelectorAll<HTMLButtonElement>("button");
    if (focusableButtons.length === 0) return;
    (focusableButtons[0] as HTMLButtonElement).focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowRegenConfirm(false);
        return;
      }
      if (e.key === "Tab") {
        const first = focusableButtons[0];
        const last = focusableButtons[focusableButtons.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [showRegenConfirm]);

  const [showErrorToast, setShowErrorToast] = useState(false);
  const errorMessage = actionData && "error" in actionData ? actionData.error : null;
  useEffect(() => {
    if (errorMessage) {
      setShowErrorToast(true);
      const timer = setTimeout(() => setShowErrorToast(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [errorMessage]);

  const revalidator = useRevalidator();
  const u = user as unknown as { streak_days: number; total_practice_days: number };

  const typedItems = items as Array<{
    id: string;
    status: string;
    item_type: string;
    content: string;
    level: number;
    preprocess_status: string;
  }>;
  const completedCount = typedItems.filter((i) => i.status === "completed").length;
  const totalCount = typedItems.length;
  const progress = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;
  const allDone = completedCount === totalCount && totalCount > 0;
  const hasStartedItems = typedItems.some((i) => i.status !== "pending");
  const hasPendingPreprocess = typedItems.some((i) => i.preprocess_status === "pending" || i.preprocess_status === "processing");
  const shouldPoll = hasPendingPreprocess || hasPendingMaterials;

  // Auto-poll every 5 seconds when there are items still being preprocessed or materials pending
  useEffect(() => {
    if (!shouldPoll) return;
    const interval = setInterval(() => {
      if (revalidator.state === "idle") {
        revalidator.revalidate();
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [shouldPoll, revalidator.state]);

  if (!plan || items.length === 0) {
    if (hasPendingMaterials) {
      return (
        <div>
          <h1 className="text-2xl font-bold text-gray-900 mb-4">今日练习</h1>
          <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center">
            <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <div className="w-8 h-8 border-4 border-blue-400 border-t-transparent rounded-full animate-spin" />
            </div>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">语料正在处理中...</h2>
            <p className="text-gray-500 mb-4">首批语料正在生成语音和韵律标注，请稍等几分钟片刻，系统将自动刷新。</p>
            <div className="text-xs text-gray-400">处理完成后会自动为你开启今日计划</div>
          </div>
        </div>
      );
    }

    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-4">今日练习</h1>
        <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center">
          <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-blue-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-gray-900 mb-2">{hasAnyMaterials ? "正在努力编排中" : "还没有语料"}</h2>
          <p className="text-gray-500 mb-4">{hasAnyMaterials ? "系统正在根据你的等级编排最合适的练习..." : "添加素材后，系统会自动为你编排每日练习"}</p>
          <Link
            to="/input"
            className="inline-block px-6 py-2.5 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            添加素材
          </Link>
        </div>
      </div>
    );
  }

  if (allDone) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-4">今日练习</h1>
        <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center">
          <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-green-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-gray-900 mb-2">今日练习完成！</h2>
          <p className="text-gray-500 mb-2">
            共完成 {completedCount} 条练习
          </p>
          <p className="text-sm text-gray-400">
            {typedItems.filter((i) => i.item_type === "review").length} 条复习 · {typedItems.filter((i) => i.item_type === "new").length} 条新学
          </p>
          {u.streak_days > 0 && (
            <p className="text-sm text-orange-500 mt-3">
              已连续练习 {u.streak_days} 天，继续保持！
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Error toast */}
      {showErrorToast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] bg-red-600 text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-2 animate-fadeIn">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
          </svg>
          <span className="text-sm font-medium">{errorMessage}</span>
        </div>
      )}

      {/* Toast notice */}
      {notice === "completed" && (
        <div className="mb-4 flex items-center justify-between bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <span className="text-sm text-amber-700">该练习已完成，无需重复练习</span>
          <button
            onClick={() => setSearchParams({}, { replace: true })}
            className="text-amber-500 hover:text-amber-700 ml-2"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Streak header */}
      {u.streak_days > 0 && (
        <div className="flex items-center gap-2 mb-3">
          <span className="text-orange-500 text-lg">🔥</span>
          <span className="text-sm font-medium text-gray-700">
            连续 {u.streak_days} 天
          </span>
        </div>
      )}

      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-gray-900">今日练习</h1>
        <button
          type="button"
          onClick={() => setShowRegenConfirm(true)}
          disabled={isRegenerating}
          className="text-sm text-blue-600 hover:text-blue-700 disabled:opacity-50"
        >
          刷新计划
        </button>
      </div>

      {/* Progress bar */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-gray-500">今日进度</span>
          <div className="flex items-center gap-2">
            {hasPendingPreprocess && (
              <button
                onClick={() => revalidator.revalidate()}
                disabled={revalidator.state !== "idle"}
                className="text-xs text-blue-600 hover:text-blue-700 disabled:opacity-50"
              >
                {revalidator.state !== "idle" ? "刷新中..." : "刷新"}
              </button>
            )}
            <span className="text-sm font-medium text-gray-900">
              {completedCount}/{totalCount}
            </span>
          </div>
        </div>
        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-600 rounded-full transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Plan items */}
      <div className="space-y-3">
        {typedItems.map((item, index) => {
          const isCompleted = item.status === "completed";
          const isReview = item.item_type === "review";
          const preprocessDone = item.preprocess_status === "done";

          return (
            <div
              key={item.id}
              className={`bg-white rounded-xl border p-4 transition-colors ${
                isCompleted
                  ? "border-green-200 bg-green-50/50"
                  : "border-gray-200"
              }`}
            >
              <div className="flex items-start gap-3">
                {/* Status indicator */}
                <div
                  className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                    isCompleted
                      ? "bg-green-500"
                      : "bg-gray-200"
                  }`}
                >
                  {isCompleted ? (
                    <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                    </svg>
                  ) : (
                    <span className="text-xs text-gray-500">{index + 1}</span>
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <p className={`text-sm leading-relaxed ${isCompleted ? "text-gray-500" : "text-gray-900"}`}>
                    {item.content}
                  </p>
                  <div className="flex items-center gap-2 mt-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      isReview
                        ? "bg-amber-50 text-amber-600"
                        : "bg-blue-50 text-blue-600"
                    }`}>
                      {isReview ? "复习" : "新学"}
                    </span>
                    <span className="text-xs text-gray-400">L{item.level}</span>
                    {!preprocessDone && (
                      <span className="text-xs text-gray-400">处理中...</span>
                    )}
                  </div>
                </div>

                {/* Action */}
                {!isCompleted && preprocessDone && (
                  <Link
                    to={`/today/${item.id}`}
                    className="px-4 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors shrink-0"
                  >
                    开始
                  </Link>
                )}
                {!isCompleted && !preprocessDone && (
                  <div className="w-12 h-6 bg-gray-200 rounded-lg animate-pulse shrink-0" />
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Regenerate confirmation modal */}
      {showRegenConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4" role="dialog" aria-modal="true">
          <div ref={regenDialogRef} className="bg-white rounded-2xl p-6 max-w-sm w-full">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">刷新计划？</h3>
            <p className="text-sm text-gray-500 mb-6">
              {hasStartedItems
                ? "已有练习记录的项目不会丢失，但未开始的项目将被重新编排。"
                : "当前计划将被替换为新的练习安排。"}
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowRegenConfirm(false)}
                className="flex-1 py-2.5 text-gray-700 border border-gray-200 rounded-xl hover:bg-gray-50 font-medium"
              >
                取消
              </button>
              <Form method="post" className="flex-1" onSubmit={() => setShowRegenConfirm(false)}>
                <input type="hidden" name="intent" value="regenerate" />
                <button
                  type="submit"
                  className="w-full py-2.5 text-white bg-blue-600 rounded-xl hover:bg-blue-700 font-medium"
                >
                  确认刷新
                </button>
              </Form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
