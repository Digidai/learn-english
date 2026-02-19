import { useState, useEffect } from "react";
import { Form, useActionData, useNavigation } from "react-router";
import { requireAuth } from "~/lib/auth.server";
import { isEnglish, splitSentences, checkDuplicates } from "../../server/services/preprocessor";
import { preprocessMaterial } from "../../server/services/minimax";
import { createMaterial } from "../../server/db/queries";
import type { Route } from "./+types/_app.input";

export function meta() {
  return [{ title: "添加素材 - Shadow Speaking" }];
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const user = await requireAuth(request, env);
  const formData = await request.formData();
  const text = String(formData.get("text") || "").trim();

  if (!text) {
    return { error: "请输入英文内容", sentences: null, submittedText: text };
  }

  // Limit input length to prevent abuse
  if (text.length > 5000) {
    return { error: "输入内容过长，请不要超过 5000 字符", sentences: null, submittedText: text };
  }

  if (!isEnglish(text)) {
    return { error: "请输入英文内容", sentences: null, submittedText: text };
  }

  // Split into sentences
  const sentences = splitSentences(text);
  if (sentences.length === 0) {
    return { error: "未检测到有效句子", sentences: null, submittedText: text };
  }

  // Check duplicates
  const { unique, duplicates } = await checkDuplicates(env.DB, user.id, sentences);

  if (unique.length === 0) {
    return {
      error: "所有句子已在语料库中",
      sentences: null,
      duplicates: duplicates.length,
      submittedText: text,
    };
  }

  // Create materials and trigger async preprocessing
  const materialIds: string[] = [];
  for (const sentence of unique) {
    const id = await createMaterial(env.DB, user.id, sentence);
    materialIds.push(id);
  }

  // Use waitUntil for async preprocessing
  const apiKey = env.MINIMAX_API_KEY;
  if (apiKey) {
    context.cloudflare.ctx.waitUntil(
      (async () => {
        // Process sentences in parallel batches of 3
        const BATCH_SIZE = 3;
        for (let i = 0; i < unique.length; i += BATCH_SIZE) {
          const batch = unique.slice(i, i + BATCH_SIZE);
          const batchIds = materialIds.slice(i, i + BATCH_SIZE);
          await Promise.allSettled(
            batch.map((sentence, j) =>
              preprocessMaterial(
                apiKey,
                sentence,
                batchIds[j],
                user.id,
                env.DB,
                env.R2
              )
            )
          );
        }
      })()
    );
  }

  return {
    success: true,
    added: unique.length,
    duplicates: duplicates.length,
    sentences: unique,
    submittedText: "",
  };
}

export default function InputPage() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  const [text, setText] = useState("");

  // Restore text on error, clear on success
  useEffect(() => {
    if (!actionData) return;
    if (actionData.error && actionData.submittedText) {
      setText(actionData.submittedText);
    } else if (actionData.success) {
      setText("");
    }
  }, [actionData]);

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-4">添加素材</h1>

      <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-4">
        <p className="text-sm text-gray-500 mb-4">
          输入你想练习的英文句子或段落，系统会自动拆句并生成练习内容。
        </p>

        <Form method="post">
          <textarea
            name="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="w-full h-40 px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none text-gray-900 placeholder-gray-400"
            placeholder="Type or paste English text here..."
            disabled={isSubmitting}
          />

          <div className="mt-4 flex justify-end">
            <button
              type="submit"
              disabled={isSubmitting || text.trim().length === 0}
              className="px-6 py-2.5 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isSubmitting ? "处理中..." : "添加"}
            </button>
          </div>
        </Form>
      </div>

      {/* Error message */}
      {actionData?.error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4">
          <p className="text-sm text-red-700">{actionData.error}</p>
          {actionData.duplicates ? (
            <p className="text-xs text-red-500 mt-1">
              {actionData.duplicates} 条重复内容已跳过
            </p>
          ) : null}
        </div>
      )}

      {/* Success message */}
      {actionData?.success && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-4">
          <p className="text-sm text-green-700">
            已添加 {actionData.added} 条素材，正在后台处理中
          </p>
          {actionData.duplicates ? (
            <p className="text-xs text-green-600 mt-1">
              {actionData.duplicates} 条重复内容已跳过
            </p>
          ) : null}
        </div>
      )}

      {/* Preview of added sentences */}
      {actionData?.sentences && actionData.sentences.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-gray-900">已添加的句子</h2>
          {actionData.sentences.map((sentence: string, i: number) => (
            <div
              key={i}
              className="bg-white rounded-xl border border-gray-200 p-4"
            >
              <p className="text-gray-900">{sentence}</p>
              <p className="text-xs text-gray-400 mt-2">处理中...</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
