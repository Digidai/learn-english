import { useState, useEffect } from "react";
import { Form, Link, redirect, useActionData, useNavigation } from "react-router";
import {
  hashPassword,
  createSession,
  setSessionCookie,
  getSessionTokenFromCookie,
  getSession,
} from "../../server/services/auth";
import type { Route } from "./+types/register";

export function meta() {
  return [{ title: "注册 - Shadow Speaking" }];
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
  const confirmPassword = String(formData.get("confirmPassword") || "");

  // Validation
  if (!username || !password) {
    return { error: "请输入用户名和密码", submittedUsername: username };
  }

  if (username.length < 2 || username.length > 20) {
    return { error: "用户名长度需在 2-20 个字符之间", submittedUsername: username };
  }

  if (!/^[a-zA-Z0-9_\u4e00-\u9fff]+$/.test(username)) {
    return { error: "用户名只能包含字母、数字、下划线和中文", submittedUsername: username };
  }

  if (password.length < 8) {
    return { error: "密码长度不能少于 8 个字符", submittedUsername: username };
  }

  if (!/(?=.*[0-9!@#$%^&*])/.test(password)) {
    return { error: "密码需包含至少一个数字或特殊字符", submittedUsername: username };
  }

  if (password !== confirmPassword) {
    return { error: "两次输入的密码不一致", submittedUsername: username };
  }

  // Check if username exists
  const existing = await env.DB.prepare(
    "SELECT id FROM users WHERE username = ?"
  )
    .bind(username)
    .first();

  if (existing) {
    return { error: "该用户名已被注册", submittedUsername: username };
  }

  // Create user
  const userId = crypto.randomUUID();
  const { hash, salt } = await hashPassword(password);

  await env.DB.prepare(
    "INSERT INTO users (id, username, password_hash, password_salt) VALUES (?, ?, ?, ?)"
  )
    .bind(userId, username, hash, salt)
    .run();

  // Auto login
  const token = await createSession(env.KV, userId);

  return redirect("/onboarding", {
    headers: {
      "Set-Cookie": setSessionCookie(token),
    },
  });
}

export default function RegisterPage() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  const [username, setUsername] = useState("");

  // Restore username on validation error
  useEffect(() => {
    if (actionData?.error && actionData.submittedUsername) {
      setUsername(actionData.submittedUsername);
    }
  }, [actionData]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Shadow Speaking</h1>
          <p className="mt-2 text-gray-600">影子跟读，练出自然口语</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
          <h2 className="text-xl font-semibold text-gray-900 mb-6">注册</h2>

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
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="2-20 个字符"
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
                autoComplete="new-password"
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="至少 8 个字符，含数字或特殊字符"
              />
            </div>

            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 mb-1">
                确认密码
              </label>
              <input
                id="confirmPassword"
                name="confirmPassword"
                type="password"
                required
                autoComplete="new-password"
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="再次输入密码"
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
              {isSubmitting ? "注册中..." : "注册"}
            </button>
          </Form>

          <p className="mt-4 text-center text-sm text-gray-600">
            已有账号？{" "}
            <Link to="/login" className="text-blue-600 hover:text-blue-700 font-medium">
              登录
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
