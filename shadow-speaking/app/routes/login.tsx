import { Form, Link, redirect, useActionData, useNavigation } from "react-router";
import {
  verifyPassword,
  createSession,
  setSessionCookie,
  checkLoginRateLimit,
  recordLoginAttempt,
  getSessionTokenFromCookie,
  getSession,
} from "../../server/services/auth";
import type { Route } from "./+types/login";

export function meta() {
  return [{ title: "登录 - Shadow Speaking" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const cookie = request.headers.get("Cookie");
  const token = getSessionTokenFromCookie(cookie);

  if (token) {
    const session = await getSession(env.KV, token);
    if (session) {
      return redirect("/today");
    }
  }

  return null;
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const formData = await request.formData();
  const username = String(formData.get("username") || "").trim();
  const password = String(formData.get("password") || "");

  if (!username || !password) {
    return { error: "请输入用户名和密码" };
  }

  // Rate limiting
  const rateLimit = await checkLoginRateLimit(env.KV, username);
  if (!rateLimit.allowed) {
    return { error: "登录尝试次数过多，请 15 分钟后再试" };
  }

  // Find user (single query includes onboarding_completed)
  const user = await env.DB.prepare(
    "SELECT id, password_hash, password_salt, onboarding_completed FROM users WHERE username = ?"
  )
    .bind(username)
    .first<{ id: string; password_hash: string; password_salt: string; onboarding_completed: number }>();

  if (!user) {
    await recordLoginAttempt(env.KV, username, false);
    return { error: "用户名或密码错误" };
  }

  // Verify password
  const valid = await verifyPassword(password, user.password_hash, user.password_salt);
  if (!valid) {
    await recordLoginAttempt(env.KV, username, false);
    return { error: "用户名或密码错误" };
  }

  // Success - create session
  await recordLoginAttempt(env.KV, username, true);
  const token = await createSession(env.KV, user.id);

  const destination = user.onboarding_completed ? "/today" : "/onboarding";

  return redirect(destination, {
    headers: {
      "Set-Cookie": setSessionCookie(token),
    },
  });
}

export default function LoginPage() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Shadow Speaking</h1>
          <p className="mt-2 text-gray-600">影子跟读，练出自然口语</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
          <h2 className="text-xl font-semibold text-gray-900 mb-6">登录</h2>

          <Form method="post" className="space-y-4">
            <div>
              <label htmlFor="username" className="block text-sm font-medium text-gray-700 mb-1">
                用户名
              </label>
              <input
                id="username"
                name="username"
                type="text"
                required
                autoComplete="username"
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="输入用户名"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
                密码
              </label>
              <input
                id="password"
                name="password"
                type="password"
                required
                autoComplete="current-password"
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="输入密码"
              />
            </div>

            {actionData?.error && (
              <p className="text-sm text-red-600">{actionData.error}</p>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-2.5 px-4 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isSubmitting ? "登录中..." : "登录"}
            </button>
          </Form>

          <p className="mt-4 text-center text-sm text-gray-600">
            还没有账号？{" "}
            <Link to="/register" className="text-blue-600 hover:text-blue-700 font-medium">
              注册
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
