import { redirect } from "react-router";
import { getOptionalAuth } from "~/lib/auth.server";
import type { Route } from "./+types/index";

export async function loader({ request, context }: Route.LoaderArgs) {
  const user = await getOptionalAuth(request, context.cloudflare.env);

  if (user) {
    if (!user.onboarding_completed) {
      return redirect("/onboarding");
    }
    return redirect("/today");
  }

  return redirect("/login");
}
