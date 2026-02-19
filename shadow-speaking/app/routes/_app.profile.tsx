import { Form, Link, useLoaderData } from "react-router";
import { requireAuth, type AuthUser } from "~/lib/auth.server";
import { getUserMaterialStats } from "../../server/db/queries";
import { LEVEL_LABELS, type Level } from "~/lib/constants";
import type { Route } from "./+types/_app.profile";

export function meta() {
  return [{ title: "个人中心 - Shadow Speaking" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const user = await requireAuth(request, env);
  const stats = await getUserMaterialStats(env.DB, user.id);

  // Use UTC+8 (Beijing time) for consistent date handling
  const now = new Date();
  const chinaOffset = 8 * 60 * 60 * 1000;
  const todayBeijing = new Date(now.getTime() + chinaOffset).toISOString().slice(0, 10);

  // Get recent practice calendar (last 30 days)
  // created_at is UTC; convert to Beijing time (+8h) before extracting date
  const calendar = await env.DB.prepare(
    `SELECT DISTINCT date(created_at, '+8 hours') as practice_date
     FROM practice_records
     WHERE user_id = ? AND date(created_at, '+8 hours') >= date(?, '-30 days')
     ORDER BY practice_date DESC`
  )
    .bind(user.id, todayBeijing)
    .all<{ practice_date: string }>();

  return {
    user,
    stats,
    practiceDates: calendar.results.map((r) => r.practice_date),
    todayBeijing,
  };
}

const DAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"];

export default function ProfilePage() {
  const { user, stats, practiceDates, todayBeijing } = useLoaderData<typeof loader>();
  const u = user as unknown as AuthUser;
  const s = stats as unknown as {
    total: number;
    unlearned: number;
    learning: number;
    mastered: number;
    byLevel: Record<number, { total: number; mastered: number }>;
  };
  const dates = practiceDates as unknown as string[];

  // Use server-provided Beijing date for calendar consistency
  const todayMs = new Date(todayBeijing as string).getTime();
  // First day of calendar (29 days ago)
  const startMs = todayMs - 29 * 86400000;
  const startDate = new Date(startMs);
  // Day of week for the start date (0=Sun, 6=Sat)
  const startDow = startDate.getUTCDay();

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-4">个人中心</h1>

      {/* User info card */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 bg-blue-100 rounded-full flex items-center justify-center">
            <span className="text-xl font-bold text-blue-600">
              {u.username?.charAt(0)?.toUpperCase() || "U"}
            </span>
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900">{u.username}</h2>
            <p className="text-sm text-gray-500">
              {LEVEL_LABELS[u.level as Level] || `L${u.level}`}
            </p>
          </div>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="bg-white rounded-2xl border border-gray-200 p-4">
          <p className="text-sm text-gray-500">连续练习</p>
          <p className="text-2xl font-bold text-gray-900">
            {u.streak_days} <span className="text-sm font-normal text-gray-400">天</span>
          </p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-200 p-4">
          <p className="text-sm text-gray-500">累计练习</p>
          <p className="text-2xl font-bold text-gray-900">
            {u.total_practice_days} <span className="text-sm font-normal text-gray-400">天</span>
          </p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-200 p-4">
          <p className="text-sm text-gray-500">最长连续</p>
          <p className="text-2xl font-bold text-gray-900">
            {u.max_streak_days} <span className="text-sm font-normal text-gray-400">天</span>
          </p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-200 p-4">
          <p className="text-sm text-gray-500">每日时长</p>
          <p className="text-2xl font-bold text-gray-900">
            {u.daily_minutes} <span className="text-sm font-normal text-gray-400">分钟</span>
          </p>
        </div>
      </div>

      {/* Corpus stats */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-4">
        <h3 className="text-sm font-medium text-gray-500 mb-4">语料库统计</h3>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-gray-600">总量</span>
            <span className="font-semibold text-gray-900">{s.total} 条</span>
          </div>

          {/* Progress bar */}
          <div className="h-3 bg-gray-100 rounded-full overflow-hidden flex">
            {s.mastered > 0 && (
              <div
                className="bg-green-500 h-full"
                style={{ width: `${(s.mastered / Math.max(s.total, 1)) * 100}%` }}
              />
            )}
            {s.learning > 0 && (
              <div
                className="bg-blue-500 h-full"
                style={{ width: `${(s.learning / Math.max(s.total, 1)) * 100}%` }}
              />
            )}
            {s.unlearned > 0 && (
              <div
                className="bg-gray-300 h-full"
                style={{ width: `${(s.unlearned / Math.max(s.total, 1)) * 100}%` }}
              />
            )}
          </div>

          <div className="flex items-center gap-4 text-sm">
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-green-500" />
              已掌握 {s.mastered}
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
              学习中 {s.learning}
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-gray-300" />
              未学 {s.unlearned}
            </span>
          </div>
        </div>
      </div>

      {/* Level progress */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-4">
        <h3 className="text-sm font-medium text-gray-500 mb-4">等级进度</h3>
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((level) => {
            const levelData = s.byLevel?.[level] || { total: 0, mastered: 0 };
            const isCurrent = level === u.level;
            return (
              <div key={level} className="flex items-center gap-3">
                <span className={`text-xs font-medium w-6 ${isCurrent ? "text-blue-600" : "text-gray-400"}`}>
                  L{level}
                </span>
                <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${isCurrent ? "bg-blue-600" : "bg-gray-300"}`}
                    style={{ width: `${Math.min(100, (levelData.mastered / 20) * 100)}%` }}
                  />
                </div>
                <span className="text-xs text-gray-400 w-12 text-right">
                  {levelData.mastered}/20
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Practice calendar (last 30 days) */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-4">
        <h3 className="text-sm font-medium text-gray-500 mb-4">练习日历（近30天）</h3>
        {/* Day-of-week labels */}
        <div className="grid grid-cols-7 gap-1.5 mb-1">
          {DAY_LABELS.map((label) => (
            <span key={label} className="text-center text-xs text-gray-400">{label}</span>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1.5">
          {/* Empty cells for alignment */}
          {Array.from({ length: startDow }, (_, i) => (
            <div key={`empty-${i}`} />
          ))}
          {Array.from({ length: 30 }, (_, i) => {
            const d = new Date(startMs + i * 86400000);
            const dateStr = d.toISOString().slice(0, 10);
            const hasPractice = dates.includes(dateStr);
            const isToday = i === 29;
            return (
              <div
                key={i}
                className={`w-full aspect-square rounded-sm ${
                  hasPractice
                    ? "bg-green-500"
                    : "bg-gray-100"
                } ${isToday ? "ring-2 ring-blue-500 ring-offset-1" : ""}`}
                title={dateStr}
              />
            );
          })}
        </div>
      </div>

      {/* Settings & logout */}
      <div className="bg-white rounded-2xl border border-gray-200 divide-y divide-gray-100">
        <Link to="/settings" className="flex items-center justify-between p-4">
          <span className="text-gray-900">设置</span>
          <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
          </svg>
        </Link>
        <Form method="post" action="/logout">
          <button type="submit" className="w-full flex items-center justify-between p-4 text-red-600 hover:bg-red-50 transition-colors rounded-b-2xl">
            <span>退出登录</span>
          </button>
        </Form>
      </div>
    </div>
  );
}
