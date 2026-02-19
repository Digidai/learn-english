import { useState } from "react";
import { AudioPlayer } from "~/components/audio/AudioPlayer";
import { AudioRecorder } from "~/components/audio/AudioRecorder";

interface Props {
  content: string;
  translation: string | null;
  audioNormalSrc: string;
  onRecording: (key: string, blob: Blob) => void;
  onSelfRating: (rating: string) => void;
  onComplete: () => void;
}

export function StageReproduction({
  content,
  translation,
  audioNormalSrc,
  onRecording,
  onSelfRating,
  onComplete,
}: Props) {
  const [hasRecorded, setHasRecorded] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const [selectedRating, setSelectedRating] = useState<string | null>(null);

  const handleRecordingComplete = (blob: Blob) => {
    const key = `stage5-${Date.now()}`;
    onRecording(key, blob);
    setHasRecorded(true);
    setShowOriginal(true);
  };

  const handleRating = (rating: string) => {
    setSelectedRating(rating);
    onSelfRating(rating);
  };

  return (
    <div className="space-y-6">
      <div className="text-center">
        <span className="inline-block px-3 py-1 bg-orange-50 text-orange-600 text-xs font-medium rounded-full mb-2">
          阶段五 · 脱稿复述
        </span>
        <p className="text-sm text-gray-500">
          凭记忆用英文说出这句话
        </p>
      </div>

      {/* Chinese hint */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6">
        <p className="text-xs text-gray-400 mb-2">中文释义</p>
        <p className="text-lg text-gray-700">{translation || "..."}</p>
        {!hasRecorded && (
          <p className="text-sm text-orange-600 mt-3">请用英文说出这句话</p>
        )}
      </div>

      {/* Recorder */}
      {!hasRecorded && (
        <AudioRecorder
          onRecordingComplete={handleRecordingComplete}
        />
      )}

      {/* Show original after recording */}
      {showOriginal && (
        <>
          <div className="bg-blue-50 rounded-xl p-4">
            <p className="text-xs text-blue-500 mb-1">原文</p>
            <p className="text-lg font-medium text-gray-900">{content}</p>
          </div>

          {/* Play original audio */}
          <AudioPlayer
            src={audioNormalSrc}
            label="原音频对照"
          />

          {/* Self rating */}
          <div className="space-y-3">
            <p className="text-sm font-medium text-gray-700 text-center">
              你觉得说得怎么样？
            </p>
            <div className="space-y-2">
              {[
                { value: "good", label: "说得不错", desc: "核心内容和关键表达基本正确" },
                { value: "fair", label: "还行，有些地方不准", desc: "大意对了，部分词句有偏差" },
                { value: "poor", label: "差距较大", desc: "说不出来或偏差很大" },
              ].map((option) => (
                <button
                  key={option.value}
                  onClick={() => handleRating(option.value)}
                  className={`w-full text-left p-4 rounded-xl border transition-colors ${
                    selectedRating === option.value
                      ? "border-blue-500 bg-blue-50"
                      : "border-gray-200 hover:border-gray-300"
                  }`}
                >
                  <p className="font-medium text-gray-900">{option.label}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{option.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {selectedRating && (
            <button
              onClick={onComplete}
              className="w-full py-3 bg-blue-600 text-white font-medium rounded-xl hover:bg-blue-700 transition-colors"
            >
              继续
            </button>
          )}
        </>
      )}
    </div>
  );
}
