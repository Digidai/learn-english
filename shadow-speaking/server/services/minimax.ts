import OpenAI from "openai";
import { stripMarkdown } from "./preprocessor";

// --- Retry helper for transient errors ---

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503]);
const RETRY_DELAY_MS = 2000;

async function fetchWithRetry(
  input: RequestInfo,
  init: RequestInit,
  retries = 1
): Promise<Response> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(input, init);
      if (response.ok || !RETRYABLE_STATUSES.has(response.status)) {
        return response;
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
    if (attempt < retries) {
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    }
  }
  throw lastError!;
}

// --- LLM Analysis ---

export interface MaterialAnalysis {
  level: number;
  translation: string;
  phonetic_notes: Array<{ original: string; pronunciation: string; type: string }>;
  pause_marks: number[];
  word_mask: number[];
  tags: string[];
  expression_prompt: string;
}

const ANALYSIS_FUNCTION = {
  name: "analyze_sentence",
  description: "Analyze an English sentence for language learning purposes",
  parameters: {
    type: "object" as const,
    properties: {
      level: {
        type: "number",
        description:
          "Difficulty level 1-5. L1: high-freq 1000 words, ≤5 words, simple. L2: high-freq 2000, 6-10 words, one clause. L3: high-freq 4000, 11-18 words, compound. L4: specialized vocab, 19-25 words, complex. L5: academic, >25 words, formal.",
      },
      translation: {
        type: "string",
        description: "Natural Chinese translation of the sentence",
      },
      phonetic_notes: {
        type: "array",
        description:
          "Phonetic phenomena: connected speech, weak forms, elision, etc.",
        items: {
          type: "object",
          properties: {
            original: { type: "string", description: "Original text" },
            pronunciation: {
              type: "string",
              description: "How it's actually pronounced",
            },
            type: {
              type: "string",
              description:
                "Type: linking, weakening, elision, contraction, assimilation",
            },
          },
          required: ["original", "pronunciation", "type"],
        },
      },
      pause_marks: {
        type: "array",
        description:
          "Word indices (0-based) where natural pauses occur in the sentence",
        items: { type: "number" },
      },
      word_mask: {
        type: "array",
        description:
          "Word indices (0-based) of content words to mask (nouns, verbs, adjectives, adverbs). Keep function words visible (articles, prepositions, conjunctions, pronouns, be verbs).",
        items: { type: "number" },
      },
      tags: {
        type: "array",
        description:
          "1-3 topic tags in Chinese, e.g. ['日常对话', '问候']",
        items: { type: "string" },
      },
      expression_prompt: {
        type: "string",
        description:
          "A Chinese prompt for free expression practice. Related to the sentence's meaning but asking the user to express a similar idea in their own words.",
      },
    },
    required: [
      "level",
      "translation",
      "phonetic_notes",
      "pause_marks",
      "word_mask",
      "tags",
      "expression_prompt",
    ],
  },
};

// Reusable OpenAI client cache (per apiKey)
let cachedClient: { key: string; client: OpenAI } | null = null;
let hasPreprocessJobsTable = false;

async function ensurePreprocessJobsTable(db: D1Database): Promise<void> {
  if (hasPreprocessJobsTable) return;
  await db.exec(
    `CREATE TABLE IF NOT EXISTS preprocess_jobs (
      material_id TEXT PRIMARY KEY,
      started_at INTEGER NOT NULL
    )`
  );
  hasPreprocessJobsTable = true;
}

function getClient(apiKey: string): OpenAI {
  if (cachedClient && cachedClient.key === apiKey) {
    return cachedClient.client;
  }
  const client = new OpenAI({
    apiKey,
    baseURL: "https://api.minimaxi.com/v1",
  });
  cachedClient = { key: apiKey, client };
  return client;
}

export async function analyzeSentence(
  apiKey: string,
  sentence: string
): Promise<MaterialAnalysis> {
  const client = getClient(apiKey);

  let response!: OpenAI.Chat.Completions.ChatCompletion;
  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= 1; attempt++) {
    try {
      response = await client.chat.completions.create(
        {
          model: "MiniMax-M2.5",
          temperature: 0.3,
          messages: [
            {
              role: "system",
              content: `You are an English language learning assistant. Analyze the given English sentence for a Chinese learner. Use the analyze_sentence function to return structured analysis.

Rules for level assessment:
- L1: High-frequency 1000 words, ≤5 words, simple statements/questions
- L2: High-frequency 2000 words, 6-10 words, one clause or prepositional phrase
- L3: High-frequency 4000 words, 11-18 words, compound sentences/passive voice
- L4: Specialized/low-frequency words, 19-25 words, multiple clauses/subjunctive
- L5: Academic/rare words, >25 words, long complex sentences
Take the highest matching dimension.

Rules for word_mask:
- Mask content words (nouns, main verbs, adjectives, adverbs)
- Keep function words (a, the, in, on, and, but, I, you, is, was, etc.)
- Target 40-60% of words masked`,
            },
            {
              role: "user",
              content: sentence,
            },
          ],
          tools: [
            {
              type: "function",
              function: ANALYSIS_FUNCTION,
            },
          ],
          tool_choice: {
            type: "function",
            function: { name: "analyze_sentence" },
          },
        },
        { signal: AbortSignal.timeout(30000) }
      );
      break;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      // Retry on transient OpenAI SDK errors (status in error object)
      const status = (err as { status?: number }).status;
      if (attempt < 1 && status && RETRYABLE_STATUSES.has(status)) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        continue;
      }
      throw lastError;
    }
  }

  const toolCall = response.choices[0]?.message?.tool_calls?.[0] as
    | { type: "function"; function: { name: string; arguments: string } }
    | undefined;
  if (!toolCall || toolCall.function.name !== "analyze_sentence") {
    throw new Error("LLM did not return expected function call");
  }

  let result: MaterialAnalysis;
  try {
    result = JSON.parse(toolCall.function.arguments);
  } catch {
    throw new Error("LLM returned invalid JSON in tool call arguments");
  }

  if (!result || typeof result.level !== "number") {
    throw new Error("LLM response missing required fields");
  }

  // Validate and clamp level
  result.level = Math.max(1, Math.min(5, Math.round(result.level)));

  return result;
}

// --- TTS Audio Generation ---

export interface TTSResult {
  audioUrl: string;
}

export async function generateTTS(
  apiKey: string,
  text: string,
  speed: number
): Promise<TTSResult> {
  const response = await fetchWithRetry(
    "https://api.minimaxi.com/v1/t2a_v2",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "speech-02-turbo",
        text,
        voice_setting: {
          voice_id: "English_FriendlyPerson",
          speed,
        },
        stream: false,
        output_format: "url",
        sample_rate: 32000,
      }),
      signal: AbortSignal.timeout(30000),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`TTS API error (${response.status}): ${errorText}`);
  }

  const data = await response.json() as {
    data?: { audio?: string };
    base_resp?: { status_code: number; status_msg: string };
  };

  if (data.base_resp?.status_code !== 0) {
    throw new Error(`TTS API error: ${data.base_resp?.status_msg || "unknown"}`);
  }

  if (!data.data?.audio) {
    throw new Error("TTS API returned no audio URL");
  }

  return { audioUrl: data.data.audio };
}

// --- Full Preprocessing Pipeline ---

export async function preprocessMaterial(
  apiKey: string,
  sentence: string,
  materialId: string,
  userId: string,
  db: D1Database,
  r2: R2Bucket
): Promise<void> {
  let didClaimProcessing = false;

  try {
    await ensurePreprocessJobsTable(db);

    // CAS: only start processing if currently pending or failed
    const cas = await db
      .prepare(
        "UPDATE materials SET preprocess_status = 'processing' WHERE id = ? AND preprocess_status IN ('pending', 'failed')"
      )
      .bind(materialId)
      .run();

    if (!cas.meta.changes) {
      // Already being processed or done — skip
      return;
    }
    didClaimProcessing = true;

    const startedAt = Math.floor(Date.now() / 1000);
    await db
      .prepare(
        "INSERT OR REPLACE INTO preprocess_jobs (material_id, started_at) VALUES (?, ?)"
      )
      .bind(materialId, startedAt)
      .run();

    // Clean markdown/URLs from text for TTS and analysis
    const cleanText = stripMarkdown(sentence);
    const wordCount = cleanText.split(/\s+/).filter(Boolean).length;
    if (cleanText.length < 5 || wordCount < 3) {
      // Not a valid sentence — update daily_plan counters, cascade-delete, then the material
      const planItemCounts = await db.prepare(
        `SELECT
            plan_id,
            COUNT(*) as total_cnt,
            SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_cnt
         FROM plan_items
         WHERE material_id = ?
         GROUP BY plan_id`
      ).bind(materialId).all<{
        plan_id: string;
        total_cnt: number;
        completed_cnt: number;
      }>();

      const statements: D1PreparedStatement[] = planItemCounts.results.map(
        ({ plan_id, total_cnt, completed_cnt }) =>
          db.prepare(
            `UPDATE daily_plans
             SET total_items = CASE
                 WHEN total_items >= ? THEN total_items - ?
                 ELSE 0
               END,
               completed_items = MIN(
                 CASE
                   WHEN completed_items >= ? THEN completed_items - ?
                   ELSE 0
                 END,
                 CASE
                   WHEN total_items >= ? THEN total_items - ?
                   ELSE 0
                 END
               )
             WHERE id = ?`
          ).bind(
            total_cnt,
            total_cnt,
            completed_cnt,
            completed_cnt,
            total_cnt,
            total_cnt,
            plan_id
          )
      );
      statements.push(
        db.prepare("DELETE FROM preprocess_jobs WHERE material_id = ?").bind(materialId),
        db.prepare("DELETE FROM plan_items WHERE material_id = ?").bind(materialId),
        db.prepare("DELETE FROM recordings WHERE material_id = ?").bind(materialId),
        db.prepare("DELETE FROM practice_records WHERE material_id = ?").bind(materialId),
        db.prepare("DELETE FROM materials WHERE id = ?").bind(materialId),
      );
      await db.batch(statements);
      return; // Skip silently — content was just a source label
    }

    // Also update stored content to cleaned version if different
    if (cleanText !== sentence) {
      await db
        .prepare("UPDATE materials SET content = ? WHERE id = ?")
        .bind(cleanText, materialId)
        .run();
    }

    // Step 1: LLM analysis (use cleaned text)
    const analysis = await analyzeSentence(apiKey, cleanText);

    // Step 2: Generate 3 TTS versions in parallel
    const speeds = [
      { speed: 0.75, key: `audio/${userId}/${materialId}/slow.mp3` },
      { speed: 1.0, key: `audio/${userId}/${materialId}/normal.mp3` },
      { speed: 1.25, key: `audio/${userId}/${materialId}/fast.mp3` },
    ];

    await Promise.all(
      speeds.map(async ({ speed, key }) => {
        const tts = await generateTTS(apiKey, cleanText, speed);
        // Download audio from temporary URL and store in R2
        const audioResponse = await fetch(tts.audioUrl);
        if (!audioResponse.ok || !audioResponse.body) {
          throw new Error(`Failed to download TTS audio: ${audioResponse.status}`);
        }
        await r2.put(key, audioResponse.body, {
          httpMetadata: { contentType: "audio/mpeg" },
        });
      })
    );

    // Step 3: Update database
    await db
      .prepare(
        `UPDATE materials SET
          level = ?,
          translation = ?,
          phonetic_notes = ?,
          pause_marks = ?,
          word_mask = ?,
          tags = ?,
          expression_prompt = ?,
          audio_slow_key = ?,
          audio_normal_key = ?,
          audio_fast_key = ?,
          preprocess_status = 'done'
        WHERE id = ?`
      )
      .bind(
        analysis.level,
        analysis.translation,
        JSON.stringify(analysis.phonetic_notes),
        JSON.stringify(analysis.pause_marks),
        JSON.stringify(analysis.word_mask),
        JSON.stringify(analysis.tags),
        analysis.expression_prompt,
        speeds[0].key,
        speeds[1].key,
        speeds[2].key,
        materialId
      )
      .run();

    await db
      .prepare("DELETE FROM preprocess_jobs WHERE material_id = ?")
      .bind(materialId)
      .run();
  } catch (error) {
    console.error(`Preprocessing failed for material ${materialId}:`, error);
    await db
      .prepare(
        "UPDATE materials SET preprocess_status = 'failed' WHERE id = ?"
      )
      .bind(materialId)
      .run();

    if (didClaimProcessing) {
      await db
        .prepare("DELETE FROM preprocess_jobs WHERE material_id = ?")
        .bind(materialId)
        .run();
    }
  }
}
