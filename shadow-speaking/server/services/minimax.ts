import OpenAI from "openai";
import { stripMarkdown } from "./preprocessor";

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

function getClient(apiKey: string): OpenAI {
  if (cachedClient && cachedClient.key === apiKey) {
    return cachedClient.client;
  }
  const client = new OpenAI({
    apiKey,
    baseURL: "https://api.minimax.io/v1",
  });
  cachedClient = { key: apiKey, client };
  return client;
}

export async function analyzeSentence(
  apiKey: string,
  sentence: string
): Promise<MaterialAnalysis> {
  const client = getClient(apiKey);

  const response = await client.chat.completions.create({
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
  });

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
  audioStream: ReadableStream;
  contentType: string;
}

export async function generateTTS(
  apiKey: string,
  text: string,
  speed: number
): Promise<TTSResult> {
  const response = await fetch("https://api.minimax.io/v1/audio/synthesis", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "speech-02-turbo",
      text,
      voice_id: "English_FriendlyPerson",
      speed,
      output_format: "mp3",
      sample_rate: 32000,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`TTS API error (${response.status}): ${errorText}`);
  }

  const contentType = response.headers.get("Content-Type") || "audio/mpeg";

  // Check if response is JSON (error) or audio
  if (contentType.includes("application/json")) {
    const errorData = await response.json();
    throw new Error(`TTS API returned error: ${JSON.stringify(errorData)}`);
  }

  if (!response.body) {
    throw new Error("TTS API returned empty body");
  }

  return { audioStream: response.body, contentType: "audio/mpeg" };
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
  try {
    // Mark as processing
    await db
      .prepare(
        "UPDATE materials SET preprocess_status = 'processing' WHERE id = ?"
      )
      .bind(materialId)
      .run();

    // Clean markdown/URLs from text for TTS and analysis
    const cleanText = stripMarkdown(sentence);
    const wordCount = cleanText.split(/\s+/).filter(Boolean).length;
    if (cleanText.length < 5 || wordCount < 3) {
      // Not a valid sentence — mark as failed with reason, delete the material
      await db
        .prepare("DELETE FROM materials WHERE id = ?")
        .bind(materialId)
        .run();
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
        // Stream directly to R2 — avoids buffering entire file in memory
        await r2.put(key, tts.audioStream, {
          httpMetadata: { contentType: tts.contentType },
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
  } catch (error) {
    console.error(`Preprocessing failed for material ${materialId}:`, error);
    await db
      .prepare(
        "UPDATE materials SET preprocess_status = 'failed' WHERE id = ?"
      )
      .bind(materialId)
      .run();
  }
}
