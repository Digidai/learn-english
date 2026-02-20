const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

export async function handleRecordingUpload(
  request: Request,
  env: Env,
  userId: string
): Promise<Response> {
  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const practiceRecordId = String(formData.get("practiceRecordId") || "");
  const materialId = String(formData.get("materialId") || "");

  const stageParsed = parseInt(String(formData.get("stage") ?? ""), 10);
  const roundParsed = parseInt(String(formData.get("round") ?? ""), 10);
  const durationParsed = parseInt(String(formData.get("durationMs") ?? ""), 10);

  const stage = Number.isFinite(stageParsed) ? stageParsed : 0;
  const round = Number.isFinite(roundParsed) ? roundParsed : 1;
  const durationMs = Number.isFinite(durationParsed) ? durationParsed : 0;
  const isSilent = formData.get("isSilent") === "true";

  if (!file || !practiceRecordId || !materialId || !stage) {
    return new Response(JSON.stringify({ error: "Missing required fields" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Enforce file size limit
  if (file.size > MAX_FILE_SIZE) {
    return new Response(JSON.stringify({ error: "File too large" }), {
      status: 413,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Verify ownership: practiceRecordId belongs to the user
  const record = await env.DB.prepare(
    "SELECT id FROM practice_records WHERE id = ? AND user_id = ?"
  )
    .bind(practiceRecordId, userId)
    .first();

  if (!record) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  const recordingId = crypto.randomUUID();
  const timestamp = Date.now();
  // Determine file extension from actual MIME type (iOS uses mp4/m4a, others use webm)
  const mime = file.type || "audio/webm";
  const ext = mime.includes("mp4") || mime.includes("m4a") ? "m4a" : "webm";
  const contentType = mime.includes("mp4") || mime.includes("m4a") ? "audio/mp4" : "audio/webm";
  const r2Key = `recordings/${userId}/${materialId}/${stage}/${round}/${timestamp}.${ext}`;

  // Stream directly to R2 — avoids buffering entire file in memory
  await env.R2.put(r2Key, file.stream(), {
    httpMetadata: { contentType },
  });

  // Write to database
  await env.DB.prepare(
    `INSERT INTO recordings
     (id, practice_record_id, material_id, stage, round, r2_key, duration_ms, is_silent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(recordingId, practiceRecordId, materialId, stage, round, r2Key, durationMs, isSilent ? 1 : 0)
    .run();

  return new Response(
    JSON.stringify({ id: recordingId, r2Key }),
    {
      status: 201,
      headers: { "Content-Type": "application/json" },
    }
  );
}
