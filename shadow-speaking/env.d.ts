// Secrets not included in wrangler types (set via `wrangler secret put`)
interface Env {
  MINIMAX_API_KEY: string;
  RETRY_PREPROCESS_ADMIN_USERS?: string;
}
