import { Link, useLoaderData, useSearchParams, Form, useNavigation } from "react-router";
import { requireAuth } from "~/lib/auth.server";
import { getUserMaterials } from "../../server/db/queries";
import { preprocessMaterial } from "../../server/services/minimax";
import { LEVEL_LABELS, type Level } from "~/lib/constants";
import type { Route } from "./+types/_app.corpus";

export function meta() {
  return [{ title: "我的语料 - Shadow Speaking" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const user = await requireAuth(request, env);

  const url = new URL(request.url);
  const status = url.searchParams.get("status") || undefined;
  const level = url.searchParams.get("level")
    ? Number(url.searchParams.get("level"))
    : undefined;
  const search = url.searchParams.get("q") || undefined;
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const limit = 20;
  const offset = (page - 1) * limit;

  const { materials, total } = await getUserMaterials(env.DB, user.id, {
    status,
    level,
    search,
    limit,
    offset,
  });

  // Count failed materials for showing retry button
  const failedCount = await env.DB.prepare(
    "SELECT COUNT(*) as count FROM materials WHERE user_id = ? AND preprocess_status = 'failed'"
  ).bind(user.id).first<{ count: number }>();

  return {
    materials,
    total,
    page,
    totalPages: Math.ceil(total / limit),
    filters: { status, level, search },
    failedCount: failedCount?.count || 0,
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const user = await requireAuth(request, env);
  const formData = await request.formData();
  const intent = String(formData.get("intent"));

  if (intent === "retry-all-failed") {
    // Get all failed materials
    const failed = await env.DB.prepare(
      "SELECT id, content FROM materials WHERE user_id = ? AND preprocess_status = 'failed'"
    ).bind(user.id).all<{ id: string; content: string }>();

    if (failed.results.length === 0) return null;

    // Reset all to pending (CAS: only reset if still failed)
    await env.DB.batch(
      failed.results.map((m) =>
        env.DB.prepare(
          "UPDATE materials SET preprocess_status = 'pending' WHERE id = ? AND preprocess_status = 'failed'"
        ).bind(m.id)
      )
    );

    // Trigger async preprocessing
    const apiKey = env.MINIMAX_API_KEY;
    if (apiKey) {
      context.cloudflare.ctx.waitUntil(
        (async () => {
          const BATCH_SIZE = 3;
          for (let i = 0; i < failed.results.length; i += BATCH_SIZE) {
            const batch = failed.results.slice(i, i + BATCH_SIZE);
            await Promise.allSettled(
              batch.map((m) =>
                preprocessMaterial(apiKey, m.content, m.id, user.id, env.DB, env.R2)
              )
            );
          }
        })()
      );
    }

    return { retried: failed.results.length };
  }

  return null;
}

export default function CorpusPage() {
  const { materials, total, page, totalPages, filters, failedCount } =
    useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigation = useNavigation();
  const isRetrying = navigation.state === "submitting";

  const handleSearch = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const q = String(formData.get("q") || "").trim();
    const params = new URLSearchParams(searchParams);
    if (q) {
      params.set("q", q);
    } else {
      params.delete("q");
    }
    params.delete("page");
    setSearchParams(params);
  };

  const setFilter = (key: string, value: string | null) => {
    const params = new URLSearchParams(searchParams);
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    params.delete("page");
    setSearchParams(params);
  };

  if (total === 0 && !filters.status && !filters.level && !filters.search) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-4">我的语料</h1>
        <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center">
          <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-gray-900 mb-2">语料库为空</h2>
          <p className="text-gray-500 mb-4">添加英文素材后，你的语料会显示在这里</p>
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

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-4">我的语料</h1>

      {/* Search */}
      <form onSubmit={handleSearch} className="mb-4">
        <div className="relative">
          <input
            name="q"
            type="text"
            defaultValue={filters.search || ""}
            placeholder="搜索语料..."
            className="w-full px-4 py-2.5 pl-10 border border-gray-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <svg className="w-5 h-5 text-gray-400 absolute left-3 top-3" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
          </svg>
        </div>
      </form>

      {/* Filters */}
      <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
        <button
          onClick={() => setFilter("status", null)}
          className={`px-3 min-h-[44px] text-xs rounded-full whitespace-nowrap transition-colors ${
            !filters.status ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
          }`}
        >
          全部
        </button>
        {[
          { value: "unlearned", label: "未学习" },
          { value: "learning", label: "学习中" },
          { value: "mastered", label: "已掌握" },
        ].map((s) => (
          <button
            key={s.value}
            onClick={() => setFilter("status", filters.status === s.value ? null : s.value)}
            className={`px-3 min-h-[44px] text-xs rounded-full whitespace-nowrap transition-colors ${
              filters.status === s.value ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {s.label}
          </button>
        ))}
        {[1, 2, 3, 4, 5].map((l) => (
          <button
            key={l}
            onClick={() => setFilter("level", filters.level === l ? null : String(l))}
            className={`px-3 min-h-[44px] text-xs rounded-full whitespace-nowrap transition-colors ${
              filters.level === l ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            L{l}
          </button>
        ))}
      </div>

      {/* Failed items retry banner */}
      {failedCount > 0 && (
        <div className="mb-4 flex items-center justify-between bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          <span className="text-sm text-red-700">{failedCount} 条语料处理失败</span>
          <Form method="post">
            <input type="hidden" name="intent" value="retry-all-failed" />
            <button
              type="submit"
              disabled={isRetrying}
              className="text-sm text-red-600 font-medium hover:text-red-700 disabled:opacity-50"
            >
              {isRetrying ? "处理中..." : "全部重试"}
            </button>
          </Form>
        </div>
      )}

      {/* Count */}
      <p className="text-sm text-gray-400 mb-3">{total} 条语料</p>

      {/* Material list */}
      <div className="space-y-3">
        {(materials as Array<{
          id: string;
          content: string;
          translation: string | null;
          status: string;
          level: number;
          tags: string;
          preprocess_status: string;
        }>).map((material) => {
          let tags: string[] = [];
          try { tags = material.tags ? JSON.parse(material.tags) : []; } catch { /* ignore */ }
          const statusColors: Record<string, string> = {
            unlearned: "bg-gray-100 text-gray-600",
            learning: "bg-blue-50 text-blue-600",
            mastered: "bg-green-50 text-green-600",
          };
          const statusLabels: Record<string, string> = {
            unlearned: "未学习",
            learning: "学习中",
            mastered: "已掌握",
          };

          return (
            <Link
              key={material.id}
              to={`/corpus/${material.id}`}
              className="block bg-white rounded-xl border border-gray-200 p-4 hover:border-gray-300 transition-colors"
            >
              <p className="text-gray-900 leading-relaxed mb-2">
                {material.content}
              </p>
              {material.translation && (
                <p className="text-sm text-gray-400 mb-3">{material.translation}</p>
              )}
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-xs px-2 py-0.5 rounded-full ${statusColors[material.status] || ""}`}>
                  {statusLabels[material.status] || material.status}
                </span>
                <span className="text-xs text-gray-400">L{material.level}</span>
                {tags.map((tag: string) => (
                  <span key={tag} className="text-xs px-2 py-0.5 bg-gray-50 text-gray-500 rounded-full">
                    {tag}
                  </span>
                ))}
                {material.preprocess_status === "pending" && (
                  <span className="text-xs text-amber-500">处理中...</span>
                )}
                {material.preprocess_status === "failed" && (
                  <span className="text-xs text-red-500">处理失败</span>
                )}
              </div>
            </Link>
          );
        })}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-6">
          {page > 1 && (
            <button
              onClick={() => setFilter("page", String(page - 1))}
              className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50"
            >
              上一页
            </button>
          )}
          <span className="text-sm text-gray-500">
            {page} / {totalPages}
          </span>
          {page < totalPages && (
            <button
              onClick={() => setFilter("page", String(page + 1))}
              className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50"
            >
              下一页
            </button>
          )}
        </div>
      )}
    </div>
  );
}
