import { createRequestHandler } from "react-router";
import { handleDailyPlanCron } from "../server/cron/daily-plan";

declare module "react-router" {
  export interface AppLoadContext {
    cloudflare: {
      env: Env;
      ctx: ExecutionContext;
    };
  }
}

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE
);

export default {
  async fetch(request, env, ctx) {
    return requestHandler(request, {
      cloudflare: { env, ctx },
    });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(handleDailyPlanCron(env));
  },
} satisfies ExportedHandler<Env>;
