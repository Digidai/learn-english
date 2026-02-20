import { requireAuth } from "~/lib/auth.server";
import { checkPracticeDataIntegrity } from "../../server/services/data-integrity";
import type { Route } from "./+types/api.integrity-check";

function parseAdminUsers(rawValue: string | undefined): Set<string> {
  if (!rawValue) return new Set();
  return new Set(
    rawValue
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean)
  );
}

export async function loader() {
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { Allow: "POST" },
  });
}

export async function action({ request, context }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "POST" },
    });
  }

  const env = context.cloudflare.env;
  let user: { id: string; username: string };
  try {
    user = await requireAuth(request, env);
  } catch (error) {
    if (error instanceof Response) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw error;
  }

  const adminUsers = parseAdminUsers(env.RETRY_PREPROCESS_ADMIN_USERS);
  if (!adminUsers.has(user.username)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const issues = await checkPracticeDataIntegrity(env.DB, 30);
  return Response.json({
    checkedAt: new Date().toISOString(),
    issueCount: issues.length,
    issues,
  });
}
