import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useNavigation } from "react-router";
import { usePracticeFlow } from "~/hooks/usePracticeFlow";
import { StageComprehension } from "./StageComprehension";
import { StageListening } from "./StageListening";
import { StageSyncReading } from "./StageSyncReading";
import { StageShadowing } from "./StageShadowing";
import { StageReproduction } from "./StageReproduction";
import { StageFreeExpression } from "./StageFreeExpression";

export interface MaterialData {
  id: string;
  content: string;
  translation: string | null;
  phonetic_notes: string | null;
  pause_marks: string | null;
  word_mask: string | null;
  expression_prompt: string | null;
  audio_slow_key: string | null;
  audio_normal_key: string | null;
  audio_fast_key: string | null;
  status: string;
  review_count: number;
}

interface PracticeFlowProps {
  material: MaterialData;
  onComplete: (data: {
    selfRating: string | null;
    isPoorPerformance: boolean;
    durationSeconds: number;
    completedAllStages: boolean;
    recordings: Map<string, Blob>;
  }) => void;
  onExit: () => void;
}

function safeJsonParse<T>(json: string | null, fallback: T): T {
  if (!json) return fallback;
  try { return JSON.parse(json) as T; } catch { return fallback; }
}

export function PracticeFlow({ material, onComplete, onExit }: PracticeFlowProps) {
  const flow = usePracticeFlow({ onComplete });
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Focus trap + Escape for exit dialog
  useEffect(() => {
    if (!showExitConfirm) return;
    const dialog = dialogRef.current;
    if (!dialog) return;

    const focusableButtons = dialog.querySelectorAll<HTMLButtonElement>("button");
    if (focusableButtons.length === 0) return;
    (focusableButtons[0] as HTMLButtonElement).focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowExitConfirm(false);
        return;
      }
      if (e.key === "Tab") {
        const first = focusableButtons[0];
        const last = focusableButtons[focusableButtons.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [showExitConfirm]);

  // Memoize parsed JSON to avoid re-parsing on every render
  const phoneticNotes = useMemo(
    () => safeJsonParse<Array<{ original: string; pronunciation: string; type: string }>>(material.phonetic_notes, []),
    [material.phonetic_notes]
  );
  const pauseMarks = useMemo(
    () => safeJsonParse<number[]>(material.pause_marks, []),
    [material.pause_marks]
  );
  const wordMask = useMemo(
    () => safeJsonParse<number[]>(material.word_mask, []),
    [material.word_mask]
  );

  const isReview = material.status !== "unlearned" && material.review_count > 0;

  const audioBase = "/api/audio/";
  const audioSlowSrc = material.audio_slow_key
    ? `${audioBase}${encodeURIComponent(material.audio_slow_key)}`
    : "";
  const audioNormalSrc = material.audio_normal_key
    ? `${audioBase}${encodeURIComponent(material.audio_normal_key)}`
    : "";

  const handleAddRecording = useCallback(
    (key: string, blob: Blob) => flow.addRecording(key, blob),
    [flow.addRecording]
  );

  // Animated stage transition: fadeOut current, then switch
  const goToStageAnimated = useCallback((stage: Parameters<typeof flow.goToStage>[0]) => {
    setIsExiting(true);
    setTimeout(() => {
      flow.goToStage(stage);
      setIsExiting(false);
    }, 150);
  }, [flow.goToStage]);

  const nextStageAnimated = useCallback(() => {
    setIsExiting(true);
    setTimeout(() => {
      flow.nextStage();
      setIsExiting(false);
    }, 150);
  }, [flow.nextStage]);

  const renderStage = () => {
    switch (flow.state.stage) {
      case 1:
        return (
          <StageComprehension
            content={material.content}
            translation={material.translation}
            phoneticNotes={phoneticNotes}
            isReview={isReview}
            onComplete={() => goToStageAnimated(2)}
          />
        );

      case 2:
        return (
          <StageListening
            content={material.content}
            audioNormalSrc={audioNormalSrc}
            onComplete={() => goToStageAnimated(3)}
          />
        );

      case 3:
        return (
          <StageSyncReading
            content={material.content}
            pauseMarks={pauseMarks}
            audioSlowSrc={audioSlowSrc}
            audioNormalSrc={audioNormalSrc}
            onRecording={handleAddRecording}
            onComplete={() => goToStageAnimated(4)}
          />
        );

      case 4:
        return (
          <StageShadowing
            key={`shadowing-${flow.state.round}`}
            content={material.content}
            wordMask={wordMask}
            audioNormalSrc={audioNormalSrc}
            onRecording={handleAddRecording}
            onLongSilence={() => flow.setHasLongSilence(true)}
            onComplete={() => goToStageAnimated(5)}
            onGoBackToRound2={flow.goBackToRound2}
            initialRound={flow.state.round}
          />
        );

      case 5:
        return (
          <StageReproduction
            content={material.content}
            translation={material.translation}
            audioNormalSrc={audioNormalSrc}
            onRecording={handleAddRecording}
            onSelfRating={(rating) => flow.setSelfRating(rating)}
            onComplete={() => goToStageAnimated(6)}
          />
        );

      case 6:
        return (
          <StageFreeExpression
            expressionPrompt={material.expression_prompt}
            onRecording={handleAddRecording}
            onComplete={nextStageAnimated}
          />
        );

      default:
        return null;
    }
  };

  // Full-screen submitting overlay
  if (isSubmitting) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-700 font-medium">正在保存练习记录...</p>
          <p className="text-sm text-gray-400 mt-1">请勿关闭页面</p>
        </div>
      </div>
    );
  }

  // Stage color mapping for progress bar
  const stageColors = ["bg-blue-600", "bg-blue-600", "bg-blue-600", "bg-purple-600", "bg-orange-500", "bg-green-600"];
  const stageLabels = ["理解", "精听", "跟读", "影子", "复述", "表达"];

  return (
    <div className="min-h-screen bg-gray-50" style={{ paddingTop: "env(safe-area-inset-top)" }}>
      {/* Header */}
      <div className="sticky top-0 bg-white/80 backdrop-blur-md border-b border-gray-100 px-4 py-2 z-10">
        <div className="max-w-lg mx-auto">
          <div className="flex items-center justify-between mb-2">
            <button
              onClick={() => setShowExitConfirm(true)}
              className="text-gray-400 hover:text-gray-600 p-1 -ml-1"
              aria-label="退出练习"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>

            <span className="text-xs font-bold text-gray-400 uppercase tracking-wider" aria-live="polite">
              STAGE {flow.state.stage} / 6
            </span>

            <div className="w-7" /> {/* Spacer for symmetry */}
          </div>

          {/* Detailed step indicator */}
          <div className="flex items-center justify-between gap-1 px-1" role="progressbar" aria-valuenow={flow.state.stage} aria-valuemin={1} aria-valuemax={6} aria-label="练习进度">
            {[1, 2, 3, 4, 5, 6].map((s) => (
              <div key={s} className="flex-1 flex flex-col items-center gap-1.5">
                <div
                  className={`h-1.5 w-full rounded-full transition-all duration-300 ${
                    s < flow.state.stage
                      ? `${stageColors[s - 1]} opacity-40`
                      : s === flow.state.stage
                      ? `${stageColors[s - 1]}`
                      : "bg-gray-200"
                  }`}
                />
                <span className={`text-[10px] font-medium transition-colors ${
                  s === flow.state.stage ? "text-gray-900" : "text-gray-400"
                }`}>
                  {stageLabels[s - 1]}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Stage content with fade transition */}
      <div className="max-w-lg mx-auto px-4 py-6" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        <div key={flow.state.stage} className={isExiting ? "animate-fade-out" : "animate-fadeIn"}>
          {renderStage()}
        </div>
      </div>

      {/* Exit confirmation modal */}
      {showExitConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4" role="dialog" aria-modal="true" aria-labelledby="exit-dialog-title">
          <div ref={dialogRef} className="bg-white rounded-2xl p-6 max-w-sm w-full">
            <h3 id="exit-dialog-title" className="text-lg font-semibold text-gray-900 mb-2">退出练习？</h3>
            <p className="text-sm text-gray-500 mb-6">
              {flow.state.stage > 1
                ? "退出后本条练习将标记为已完成（部分完成），不可重新开始。"
                : "当前进度不会保存，下次需要重新开始这条练习。"}
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowExitConfirm(false)}
                className="flex-1 py-2.5 text-gray-700 border border-gray-200 rounded-xl hover:bg-gray-50 font-medium"
                autoFocus
              >
                继续练习
              </button>
              <button
                onClick={() => {
                  if (flow.state.stage > 1) {
                    flow.exitEarly();
                  } else {
                    onExit();
                  }
                }}
                className="flex-1 py-2.5 text-red-600 border border-red-200 rounded-xl hover:bg-red-50 font-medium"
              >
                退出
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
