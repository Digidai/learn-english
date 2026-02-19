import { redirect } from "react-router";
import {
  destroySession,
  getSessionTokenFromCookie,
  clearSessionCookie,
} from "../../server/services/auth";
import type { Route } from "./+types/logout";

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const cookie = request.headers.get("Cookie");
  const token = getSessionTokenFromCookie(cookie);

  if (token) {
    await destroySession(env.KV, token);
  }

  return redirect("/login", {
    headers: {
      "Set-Cookie": clearSessionCookie(),
    },
  });
}

export async function loader() {
  return redirect("/login");
}
