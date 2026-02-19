import { Link, useLoaderData, Form, useNavigation } from "react-router";
import { requireAuth } from "~/lib/auth.server";
import { getTodayPlan } from "../../server/db/queries";
import { generateDailyPlan } from "../../server/services/plan-generator";
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

  return { plan, items, user };
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
    await regenerateDailyPlan(env.DB, user, today);
  }

  return null;
}

export default function TodayPage() {
  const { plan, items } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const isRegenerating = navigation.state === "submitting";

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

  if (!plan || items.length === 0) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-4">今日练习</h1>
        <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center">
          <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-blue-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-gray-900 mb-2">暂无练习计划</h2>
          <p className="text-gray-500 mb-4">添加素材后，系统会自动为你编排每日练习</p>
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
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-gray-900">今日练习</h1>
        <Form method="post">
          <input type="hidden" name="intent" value="regenerate" />
          <button
            type="submit"
            disabled={isRegenerating}
            className="text-sm text-blue-600 hover:text-blue-700 disabled:opacity-50"
          >
            刷新计划
          </button>
        </Form>
      </div>

      {/* Progress bar */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-gray-500">今日进度</span>
          <span className="text-sm font-medium text-gray-900">
            {completedCount}/{totalCount}
          </span>
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
    </div>
  );
}
