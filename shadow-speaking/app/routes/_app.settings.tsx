import { useState } from "react";
import { Form, Link, useLoaderData, useActionData, useNavigation } from "react-router";
import { requireAuth, type AuthUser } from "~/lib/auth.server";
import { LEVEL_LABELS, type Level } from "~/lib/constants";
import type { Route } from "./+types/_app.settings";

export function meta() {
  return [{ title: "设置 - Shadow Speaking" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const user = await requireAuth(request, env);
  return { user };
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const user = await requireAuth(request, env);
  const formData = await request.formData();
  const intent = String(formData.get("intent"));

  if (intent === "update_duration") {
    const minutes = Number(formData.get("daily_minutes") || 20);
    if ([10, 20, 30].includes(minutes)) {
      await env.DB.prepare("UPDATE users SET daily_minutes = ? WHERE id = ?")
        .bind(minutes, user.id)
        .run();
      return { success: true, message: "每日时长已更新" };
    }
  }

  if (intent === "update_level") {
    const level = Number(formData.get("level") || 1);
    if (level >= 1 && level <= 5) {
      await env.DB.prepare("UPDATE users SET level = ? WHERE id = ?")
        .bind(level, user.id)
        .run();
      return { success: true, message: "等级已更新" };
    }
  }

  return null;
}

export default function SettingsPage() {
  const { user } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const u = user as unknown as AuthUser;
  const [selectedMinutes, setSelectedMinutes] = useState(u.daily_minutes);
  const [selectedLevel, setSelectedLevel] = useState(u.level);

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-4">设置</h1>

      {actionData?.success && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-3 mb-4">
          <p className="text-sm text-green-700">
            {(actionData as { success: boolean; message: string }).message}
          </p>
        </div>
      )}

      {/* Daily duration */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-4">
        <h3 className="text-sm font-medium text-gray-500 mb-4">每日练习时长</h3>
        <Form method="post" className="space-y-3">
          <input type="hidden" name="intent" value="update_duration" />
          <input type="hidden" name="daily_minutes" value={selectedMinutes} />
          <div className="flex gap-3">
            {[10, 20, 30].map((m) => (
              <label
                key={m}
                onClick={() => setSelectedMinutes(m)}
                className={`flex-1 text-center p-3 rounded-xl border cursor-pointer transition-colors ${
                  selectedMinutes === m
                    ? "border-blue-500 bg-blue-50 text-blue-600"
                    : "border-gray-200 hover:border-gray-300 text-gray-700"
                }`}
              >
                <input
                  type="radio"
                  name="_daily_minutes"
                  value={m}
                  checked={selectedMinutes === m}
                  onChange={() => setSelectedMinutes(m)}
                  className="sr-only"
                />
                <p className="font-semibold">{m}</p>
                <p className="text-xs">分钟</p>
              </label>
            ))}
          </div>
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-2.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            保存
          </button>
        </Form>
      </div>

      {/* Level adjustment */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-4">
        <h3 className="text-sm font-medium text-gray-500 mb-2">当前等级</h3>
        <p className="text-xs text-gray-400 mb-4">
          等级影响每日材料难度，建议根据实际水平选择
        </p>
        <Form method="post" className="space-y-3">
          <input type="hidden" name="intent" value="update_level" />
          <input type="hidden" name="level" value={selectedLevel} />
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map((l) => (
              <label
                key={l}
                onClick={() => setSelectedLevel(l)}
                className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                  selectedLevel === l
                    ? "border-blue-500 bg-blue-50"
                    : "border-gray-200 hover:border-gray-300"
                }`}
              >
                <input
                  type="radio"
                  name="_level"
                  value={l}
                  checked={selectedLevel === l}
                  onChange={() => setSelectedLevel(l)}
                  className="sr-only"
                />
                <span className="text-sm font-medium text-gray-900">
                  {LEVEL_LABELS[l as Level]}
                </span>
              </label>
            ))}
          </div>
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-2.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            保存
          </button>
        </Form>
      </div>

      {/* Back link */}
      <Link
        to="/profile"
        className="block text-center text-sm text-blue-600 hover:text-blue-700"
      >
        返回个人中心
      </Link>
    </div>
  );
}
