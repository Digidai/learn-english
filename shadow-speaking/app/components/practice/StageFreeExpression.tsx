import { useState } from "react";
import { AudioRecorder } from "~/components/audio/AudioRecorder";

interface Props {
  expressionPrompt: string | null;
  onRecording: (key: string, blob: Blob) => void;
  onComplete: () => void;
}

const SENTENCE_STARTERS = [
  "I think...",
  "In my experience...",
  "What I mean is...",
  "The way I see it...",
];

export function StageFreeExpression({
  expressionPrompt,
  onRecording,
  onComplete,
}: Props) {
  const [hasRecorded, setHasRecorded] = useState(false);

  const handleRecordingComplete = (blob: Blob) => {
    const key = `stage6-${Date.now()}`;
    onRecording(key, blob);
    setHasRecorded(true);
  };

  return (
    <div className="space-y-6">
      <div className="text-center">
        <span className="inline-block px-3 py-1 bg-green-50 text-green-600 text-xs font-medium rounded-full mb-2">
          阶段六 · 自由表达
        </span>
        <p className="text-sm text-gray-500">
          用自己的话表达相似的意思
        </p>
      </div>

      {/* Expression prompt */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6">
        <p className="text-xs text-gray-400 mb-2">表达提示</p>
        <p className="text-lg text-gray-700">
          {expressionPrompt || "请用自己的话表达类似的意思"}
        </p>
      </div>

      {/* Sentence starters for scaffolding */}
      {!hasRecorded && (
        <div className="bg-gray-50 rounded-xl p-4">
          <p className="text-xs text-gray-500 mb-2">可以这样开头</p>
          <div className="flex flex-wrap gap-2">
            {SENTENCE_STARTERS.map((starter) => (
              <span
                key={starter}
                className="px-3 py-1 bg-white border border-gray-200 rounded-full text-sm text-gray-600"
              >
                {starter}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="bg-green-50 rounded-xl p-3">
        <p className="text-xs text-green-600 text-center">
          没有标准答案，大胆开口就好
        </p>
      </div>

      {/* Recorder */}
      {!hasRecorded && (
        <AudioRecorder
          onRecordingComplete={handleRecordingComplete}
        />
      )}

      {/* Complete button */}
      {hasRecorded && (
        <button
          onClick={onComplete}
          className="w-full py-3 bg-green-600 text-white font-medium rounded-xl hover:bg-green-700 transition-colors"
        >
          完成本条练习
        </button>
      )}
    </div>
  );
}
