import { useState } from "react";
import { AudioPlayer } from "~/components/audio/AudioPlayer";

interface Props {
  content: string;
  audioNormalSrc: string;
  onComplete: () => void;
}

export function StageListening({ content, audioNormalSrc, onComplete }: Props) {
  const [playCount, setPlayCount] = useState(0);
  const [showWarning, setShowWarning] = useState(false);

  const handleReady = () => {
    if (playCount <= 1) {
      setShowWarning(true);
    } else {
      onComplete();
    }
  };

  return (
    <div className="space-y-6">
      <div className="text-center">
        <span className="inline-block px-3 py-1 bg-blue-50 text-blue-600 text-xs font-medium rounded-full mb-4">
          阶段二 · 精听
        </span>
        <p className="text-sm text-gray-500">
          仔细听音频，注意语速、语调和节奏，不需要出声
        </p>
      </div>

      {/* Text display */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6">
        <p className="text-xl font-medium text-gray-900 leading-relaxed">
          {content}
        </p>
      </div>

      {/* Audio player */}
      <AudioPlayer
        src={audioNormalSrc}
        label="常速音频"
        showCount
        onEnded={() => setPlayCount((c) => c + 1)}
      />

      <p className="text-center text-sm text-gray-400">
        已听 {playCount} 遍
      </p>

      {/* Warning modal */}
      {showWarning && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <p className="text-sm text-amber-700 mb-3">
            建议至少听 2 遍，留意语调和节奏
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setShowWarning(false)}
              className="flex-1 py-2 text-sm text-amber-700 border border-amber-300 rounded-lg hover:bg-amber-100 transition-colors"
            >
              继续听
            </button>
            <button
              onClick={onComplete}
              className="flex-1 py-2 text-sm text-white bg-amber-600 rounded-lg hover:bg-amber-700 transition-colors"
            >
              我已熟悉，继续
            </button>
          </div>
        </div>
      )}

      {!showWarning && (
        <button
          onClick={handleReady}
          disabled={playCount === 0}
          className="w-full py-3 bg-blue-600 text-white font-medium rounded-xl hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          准备好了
        </button>
      )}
    </div>
  );
}
