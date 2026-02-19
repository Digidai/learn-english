import { redirect } from "react-router";
import {
  getSession,
  getSessionTokenFromCookie,
} from "../../server/services/auth";

export interface AuthUser {
  id: string;
  username: string;
  level: number;
  daily_minutes: number;
  streak_days: number;
  max_streak_days: number;
  total_practice_days: number;
  last_practice_date: string | null;
  onboarding_completed: number;
}

export async function requireAuth(
  request: Request,
  env: Env
): Promise<AuthUser> {
  const cookie = request.headers.get("Cookie");
  const token = getSessionTokenFromCookie(cookie);

  if (!token) {
    throw redirect("/login");
  }

  const session = await getSession(env.KV, token);
  if (!session) {
    throw redirect("/login");
  }

  const user = await env.DB.prepare(
    "SELECT id, username, level, daily_minutes, streak_days, max_streak_days, total_practice_days, last_practice_date, onboarding_completed FROM users WHERE id = ?"
  )
    .bind(session.userId)
    .first<AuthUser>();

  if (!user) {
    throw redirect("/login");
  }

  return user;
}

export async function getOptionalAuth(
  request: Request,
  env: Env
): Promise<AuthUser | null> {
  const cookie = request.headers.get("Cookie");
  const token = getSessionTokenFromCookie(cookie);

  if (!token) return null;

  const session = await getSession(env.KV, token);
  if (!session) return null;

  const user = await env.DB.prepare(
    "SELECT id, username, level, daily_minutes, streak_days, max_streak_days, total_practice_days, last_practice_date, onboarding_completed FROM users WHERE id = ?"
  )
    .bind(session.userId)
    .first<AuthUser>();

  return user;
}
