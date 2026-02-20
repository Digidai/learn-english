import { requireAuth } from "~/lib/auth.server";
import type { Route } from "./+types/api.audio";

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const user = await requireAuth(request, env);
  const key = params.key;

  if (!key) {
    return new Response("Not found", { status: 404 });
  }

  // Validate that the audio key belongs to this user
  const isUserAudio = key.startsWith(`audio/${user.id}/`) || key.startsWith(`recordings/${user.id}/`);
  if (!isUserAudio) {
    return new Response("Forbidden", { status: 403 });
  }

  // Parse Range header for streaming support
  const rangeHeader = request.headers.get("Range");
  const options: R2GetOptions = {};
  let rangeRequest: { offset: number; length?: number } | undefined;

  if (rangeHeader) {
    const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
    if (match) {
      const start = parseInt(match[1], 10);
      const end = match[2] ? parseInt(match[2], 10) : undefined;
      options.range = end !== undefined
        ? { offset: start, length: end - start + 1 }
        : { offset: start };
      rangeRequest = options.range as { offset: number; length?: number };
    }
  }

  const object = await env.R2.get(key, options);
  if (!object) {
    return new Response("Not found", { status: 404 });
  }

  const headers = new Headers();
  headers.set("Content-Type", object.httpMetadata?.contentType || "audio/mpeg");
  headers.set("Accept-Ranges", "bytes");
  headers.set("Content-Length", String(object.size));
  headers.set("ETag", object.etag);

  // Immutable cache for TTS, shorter for recordings
  if (key.startsWith("audio/")) {
    headers.set("Cache-Control", "private, max-age=86400, immutable");
  } else {
    headers.set("Cache-Control", "private, max-age=3600");
  }

  // Handle range response
  if (rangeRequest && object.range) {
    const r = object.range as { offset: number; length?: number };
    const length = r.length ?? (object.size - r.offset);
    if (length > 0) {
      headers.set(
        "Content-Range",
        `bytes ${r.offset}-${r.offset + length - 1}/${object.size}`
      );
      headers.set("Content-Length", String(length));
      return new Response(object.body, { status: 206, headers });
    }
  }

  return new Response(object.body, { headers });
}
