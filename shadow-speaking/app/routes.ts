import {
  type RouteConfig,
  index,
  layout,
  route,
} from "@react-router/dev/routes";

export default [
  // Public routes
  index("routes/index.tsx"),
  route("login", "routes/login.tsx"),
  route("register", "routes/register.tsx"),
  route("logout", "routes/logout.tsx"),
  route("onboarding", "routes/onboarding.tsx"),

  // Authenticated app routes with tab layout
  layout("routes/_app.tsx", { id: "app-layout" }, [
    route("today", "routes/_app.today.tsx"),
    route("today/:planItemId", "routes/_app.today.$planItemId.tsx"),
    route("input", "routes/_app.input.tsx"),
    route("corpus", "routes/_app.corpus.tsx"),
    route("corpus/:id", "routes/_app.corpus.$id.tsx"),
    route("profile", "routes/_app.profile.tsx"),
    route("settings", "routes/_app.settings.tsx"),
  ]),

  // API routes
  route("api/audio/:key", "routes/api.audio.tsx"),
  route("api/retry-preprocess", "routes/api.retry-preprocess.tsx"),
] satisfies RouteConfig;
