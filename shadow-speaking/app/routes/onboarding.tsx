import { useState, useEffect } from "react";
import { Form, redirect, useLoaderData, useActionData, useNavigation } from "react-router";
import { requireAuth } from "~/lib/auth.server";
import { COLD_START_PACKS, importColdStartPack } from "../../server/services/cold-start";
import type { Route } from "./+types/onboarding";

export function meta() {
  return [{ title: "新手引导 - Shadow Speaking" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const user = await requireAuth(request, context.cloudflare.env);
  if (user.onboarding_completed) {
    return redirect("/today");
  }
  return {
    user,
    packs: COLD_START_PACKS.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      count: p.sentences.length,
    })),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const user = await requireAuth(request, env);
  const formData = await request.formData();
  const step = String(formData.get("step"));

  if (step === "duration") {
    const minutes = Number(formData.get("minutes") || 20);
    await env.DB.prepare("UPDATE users SET daily_minutes = ? WHERE id = ?")
      .bind(minutes, user.id)
      .run();
    return { step: "duration", success: true };
  }

  if (step === "level") {
    const level = Number(formData.get("level") || 1);
    await env.DB.prepare("UPDATE users SET level = ? WHERE id = ?")
      .bind(level, user.id)
      .run();
    return { step: "level", success: true };
  }

  if (step === "packs") {
    const selectedPacks = formData.getAll("packs") as string[];
    let totalImported = 0;
    for (const packId of selectedPacks) {
      const count = await importColdStartPack(env.DB, user.id, packId);
      totalImported += count;
    }
    return { step: "packs", success: true, imported: totalImported };
  }

  if (step === "complete") {
    await env.DB.prepare(
      "UPDATE users SET onboarding_completed = 1 WHERE id = ?"
    )
      .bind(user.id)
      .run();
    return redirect("/today");
  }

  return null;
}

export default function OnboardingPage() {
  const { packs } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const [currentStep, setCurrentStep] = useState(1);
  const [selectedLevel, setSelectedLevel] = useState(2);
  const [selectedMinutes, setSelectedMinutes] = useState(20);
  const [selectedPacks, setSelectedPacks] = useState<string[]>([]);

  // Advance step based on action results
  useEffect(() => {
    if (actionData?.success && actionData.step === "level" && currentStep === 2) {
      setCurrentStep(3);
    }
    if (actionData?.success && actionData.step === "duration" && currentStep === 3) {
      setCurrentStep(4);
    }
    if (actionData?.success && actionData.step === "packs" && currentStep === 4) {
      setCurrentStep(5);
    }
  }, [actionData, currentStep]);

  const steps = [
    { num: 1, label: "欢迎" },
    { num: 2, label: "等级" },
    { num: 3, label: "时长" },
    { num: 4, label: "语料" },
    { num: 5, label: "完成" },
  ];

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8">
      <div className="max-w-md mx-auto">
        {/* Progress indicator */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {steps.map((s) => (
            <div
              key={s.num}
              className={`w-2 h-2 rounded-full transition-colors ${
                s.num <= currentStep ? "bg-blue-600" : "bg-gray-200"
              }`}
            />
          ))}
        </div>

        {/* Step 1: Welcome */}
        {currentStep === 1 && (
          <div className="text-center">
            <h1 className="text-3xl font-bold text-gray-900 mb-3">
              欢迎来到 Shadow Speaking
            </h1>
            <p className="text-lg text-gray-600 mb-8">
              每天 15 分钟，用影子跟读法练出自然的英语口语
            </p>
            <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-6 text-left space-y-4">
              <div className="flex items-center gap-3">
                <span className="text-2xl">👂</span>
                <span className="text-gray-700">先理解，再跟读</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-2xl">🎵</span>
                <span className="text-gray-700">韵律优先，循序渐进</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-2xl">🎤</span>
                <span className="text-gray-700">大声开口，录音对比</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-2xl">🔄</span>
                <span className="text-gray-700">科学复习，长期记忆</span>
              </div>
            </div>
            <button
              onClick={() => setCurrentStep(2)}
              className="w-full py-3 bg-blue-600 text-white font-medium rounded-xl hover:bg-blue-700 transition-colors"
            >
              开始设置
            </button>
          </div>
        )}

        {/* Step 2: Level selection (simplified) */}
        {currentStep === 2 && (
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2 text-center">
              选择你的英语水平
            </h2>
            <p className="text-gray-500 text-center mb-6">
              这会影响每日练习的难度，之后可以调整
            </p>

            <div className="space-y-3 mb-6">
              {[
                { level: 1, label: "L1 · 入门", desc: "简单问候和日常短句" },
                { level: 2, label: "L2 · 基础", desc: "日常对话，含简单从句" },
                { level: 3, label: "L3 · 中级", desc: "复合句，被动语态" },
                { level: 4, label: "L4 · 中高级", desc: "多重从句，专业表达" },
                { level: 5, label: "L5 · 高级", desc: "学术长难句" },
              ].map((item) => (
                <button
                  key={item.level}
                  onClick={() => setSelectedLevel(item.level)}
                  className={`w-full text-left p-4 rounded-xl border transition-colors ${
                    selectedLevel === item.level
                      ? "border-blue-500 bg-blue-50"
                      : "border-gray-200 hover:border-gray-300"
                  }`}
                >
                  <p className="font-medium text-gray-900">{item.label}</p>
                  <p className="text-sm text-gray-500">{item.desc}</p>
                </button>
              ))}
            </div>

            <Form method="post">
              <input type="hidden" name="step" value="level" />
              <input type="hidden" name="level" value={selectedLevel} />
              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full py-3 bg-blue-600 text-white font-medium rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                确定
              </button>
            </Form>
          </div>
        )}

        {/* Step 3: Duration */}
        {currentStep === 3 && (
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2 text-center">
              每天练习多久？
            </h2>
            <p className="text-gray-500 text-center mb-6">
              选择适合自己的练习时长
            </p>

            <div className="space-y-3 mb-6">
              {[
                { minutes: 10, label: "10 分钟", desc: "约 5 条 · 适合碎片时间" },
                { minutes: 20, label: "20 分钟", desc: "约 10 条 · 推荐" },
                { minutes: 30, label: "30 分钟", desc: "约 15 条 · 深度练习" },
              ].map((item) => (
                <button
                  key={item.minutes}
                  onClick={() => setSelectedMinutes(item.minutes)}
                  className={`w-full text-left p-4 rounded-xl border transition-colors ${
                    selectedMinutes === item.minutes
                      ? "border-blue-500 bg-blue-50"
                      : "border-gray-200 hover:border-gray-300"
                  }`}
                >
                  <p className="font-medium text-gray-900">{item.label}</p>
                  <p className="text-sm text-gray-500">{item.desc}</p>
                </button>
              ))}
            </div>

            <Form method="post">
              <input type="hidden" name="step" value="duration" />
              <input type="hidden" name="minutes" value={selectedMinutes} />
              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full py-3 bg-blue-600 text-white font-medium rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                确定
              </button>
            </Form>
          </div>
        )}

        {/* Step 4: Cold start packs */}
        {currentStep === 4 && (
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2 text-center">
              选择语料包
            </h2>
            <p className="text-gray-500 text-center mb-6">
              选择 1-3 个感兴趣的主题，快速开始练习
            </p>

            <div className="space-y-3 mb-6">
              {(packs as Array<{ id: string; name: string; description: string; count: number }>).map((pack) => {
                const isSelected = selectedPacks.includes(pack.id);
                return (
                  <button
                    key={pack.id}
                    onClick={() => {
                      setSelectedPacks((prev) =>
                        isSelected
                          ? prev.filter((p) => p !== pack.id)
                          : prev.length < 3
                          ? [...prev, pack.id]
                          : prev
                      );
                    }}
                    className={`w-full text-left p-4 rounded-xl border transition-colors ${
                      isSelected
                        ? "border-blue-500 bg-blue-50"
                        : "border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-gray-900">{pack.name}</p>
                        <p className="text-sm text-gray-500">{pack.description}</p>
                      </div>
                      <span className="text-xs text-gray-400">{pack.count} 条</span>
                    </div>
                  </button>
                );
              })}
            </div>

            <Form method="post">
              <input type="hidden" name="step" value="packs" />
              {selectedPacks.map((p) => (
                <input key={p} type="hidden" name="packs" value={p} />
              ))}
              <button
                type="submit"
                disabled={isSubmitting || selectedPacks.length === 0}
                className="w-full py-3 bg-blue-600 text-white font-medium rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                导入所选语料 ({selectedPacks.length})
              </button>
            </Form>

            <button
              onClick={() => setCurrentStep(5)}
              className="w-full mt-2 py-2 text-sm text-gray-500 hover:text-gray-700"
            >
              跳过，稍后添加
            </button>
          </div>
        )}

        {/* Step 5: Complete */}
        {currentStep === 5 && (
          <div className="text-center">
            <div className="w-20 h-20 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-6">
              <svg className="w-10 h-10 text-green-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">
              设置完成！
            </h2>
            <p className="text-gray-500 mb-8">
              系统会为你生成每日练习计划，开始你的口语提升之旅吧
            </p>
            <Form method="post">
              <input type="hidden" name="step" value="complete" />
              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full py-3 bg-blue-600 text-white font-medium rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                开始练习
              </button>
            </Form>
          </div>
        )}
      </div>
    </div>
  );
}
