import { useState } from "react";
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

export function PracticeFlow({ material, onComplete, onExit }: PracticeFlowProps) {
  const flow = usePracticeFlow({ onComplete });
  const [showExitConfirm, setShowExitConfirm] = useState(false);

  const safeJsonParse = <T,>(json: string | null, fallback: T): T => {
    if (!json) return fallback;
    try { return JSON.parse(json) as T; } catch { return fallback; }
  };

  const phoneticNotes = safeJsonParse<Array<{ original: string; pronunciation: string; type: string }>>(
    material.phonetic_notes, []
  );
  const pauseMarks = safeJsonParse<number[]>(material.pause_marks, []);
  const wordMask = safeJsonParse<number[]>(material.word_mask, []);

  const isReview = material.status !== "unlearned" && material.review_count > 0;

  const audioBase = "/api/audio/";
  const audioSlowSrc = material.audio_slow_key
    ? `${audioBase}${encodeURIComponent(material.audio_slow_key)}`
    : "";
  const audioNormalSrc = material.audio_normal_key
    ? `${audioBase}${encodeURIComponent(material.audio_normal_key)}`
    : "";

  const renderStage = () => {
    switch (flow.state.stage) {
      case 1:
        return (
          <StageComprehension
            content={material.content}
            translation={material.translation}
            phoneticNotes={phoneticNotes}
            isReview={isReview}
            onComplete={() => flow.goToStage(2)}
          />
        );

      case 2:
        return (
          <StageListening
            content={material.content}
            audioNormalSrc={audioNormalSrc}
            onComplete={() => flow.goToStage(3)}
          />
        );

      case 3:
        return (
          <StageSyncReading
            content={material.content}
            pauseMarks={pauseMarks}
            audioSlowSrc={audioSlowSrc}
            audioNormalSrc={audioNormalSrc}
            onRecording={(key, blob) => flow.addRecording(key, blob)}
            onComplete={() => flow.goToStage(4)}
          />
        );

      case 4:
        return (
          <StageShadowing
            content={material.content}
            wordMask={wordMask}
            audioNormalSrc={audioNormalSrc}
            onRecording={(key, blob) => flow.addRecording(key, blob)}
            onLongSilence={() => flow.setHasLongSilence(true)}
            onComplete={() => flow.goToStage(5)}
            onGoBackToRound2={flow.goBackToRound2}
          />
        );

      case 5:
        return (
          <StageReproduction
            content={material.content}
            translation={material.translation}
            audioNormalSrc={audioNormalSrc}
            onRecording={(key, blob) => flow.addRecording(key, blob)}
            onSelfRating={(rating) => flow.setSelfRating(rating)}
            onComplete={() => flow.goToStage(6)}
          />
        );

      case 6:
        return (
          <StageFreeExpression
            expressionPrompt={material.expression_prompt}
            onRecording={(key, blob) => flow.addRecording(key, blob)}
            onComplete={flow.nextStage}
          />
        );

      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="sticky top-0 bg-white border-b border-gray-100 px-4 py-3 z-10">
        <div className="flex items-center justify-between max-w-lg mx-auto">
          <button
            onClick={() => setShowExitConfirm(true)}
            className="text-gray-500 hover:text-gray-700"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>

          {/* Stage progress */}
          <div className="flex items-center gap-1.5">
            {[1, 2, 3, 4, 5, 6].map((s) => (
              <div
                key={s}
                className={`h-1.5 rounded-full transition-all ${
                  s < flow.state.stage
                    ? "w-6 bg-blue-600"
                    : s === flow.state.stage
                    ? "w-8 bg-blue-600"
                    : "w-6 bg-gray-200"
                }`}
              />
            ))}
          </div>

          <span className="text-xs text-gray-400">
            {flow.state.stage}/6
          </span>
        </div>
      </div>

      {/* Stage content */}
      <div className="max-w-lg mx-auto px-4 py-6">
        {renderStage()}
      </div>

      {/* Exit confirmation */}
      {showExitConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">退出练习？</h3>
            <p className="text-sm text-gray-500 mb-6">
              当前进度不会保存，下次需要重新开始这条练习。
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowExitConfirm(false)}
                className="flex-1 py-2.5 text-gray-700 border border-gray-200 rounded-xl hover:bg-gray-50 font-medium"
              >
                继续练习
              </button>
              <button
                onClick={onExit}
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
