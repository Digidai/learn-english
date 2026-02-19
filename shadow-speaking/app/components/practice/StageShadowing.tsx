import { useState, useMemo, useCallback, useRef } from "react";
import { AudioPlayer } from "~/components/audio/AudioPlayer";
import { AudioRecorder } from "~/components/audio/AudioRecorder";
import { useSilenceDetection } from "~/hooks/useSilenceDetection";

interface Props {
  content: string;
  wordMask: number[];
  audioNormalSrc: string;
  onRecording: (key: string, blob: Blob) => void;
  onLongSilence: () => void;
  onComplete: () => void;
  onGoBackToRound2: () => void;
  /** Initial round (default 1). Used when parent resets to round 2 via key prop. */
  initialRound?: number;
}

export function StageShadowing({
  content,
  wordMask,
  audioNormalSrc,
  onRecording,
  onLongSilence,
  onComplete,
  onGoBackToRound2,
  initialRound = 1,
}: Props) {
  const [round, setRound] = useState(initialRound);
  // Track which rounds are actually completed in THIS mount
  const [roundsCompleted, setRoundsCompleted] = useState<number[]>(
    // If starting from round 2 (goBackToRound2), assume round 1 was done
    initialRound > 1 ? Array.from({ length: initialRound - 1 }, (_, i) => i + 1) : []
  );
  const [showRetryPrompt, setShowRetryPrompt] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const silenceDetection = useSilenceDetection();
  const silenceRef = useRef(silenceDetection);
  silenceRef.current = silenceDetection;

  const words = content.split(" ");

  // Stable random heights for wave animation (avoid Math.random in render)
  const waveHeights = useMemo(
    () => [28, 36, 24, 32, 40],
    []
  );

  // Round 1: Full text visible
  // Round 2: Partial masking (word_mask indices hidden)
  // Round 3: No text
  const getDisplayText = () => {
    if (round === 1) {
      return (
        <p className="text-xl font-medium text-gray-900 leading-relaxed">
          {content}
        </p>
      );
    }

    if (round === 2) {
      return (
        <p className="text-xl font-medium text-gray-900 leading-relaxed">
          {words.map((word, i) => (
            <span key={i}>
              {wordMask.includes(i) ? (
                <span className="inline-block border-b-2 border-gray-300 text-transparent select-none">
                  {"_".repeat(word.length)}
                </span>
              ) : (
                word
              )}
              {i < words.length - 1 ? " " : ""}
            </span>
          ))}
        </p>
      );
    }

    // Round 3: no text
    return null;
  };

  const getRoundInfo = () => {
    switch (round) {
      case 1:
        return {
          title: "第 1 轮 · 韵律跟读",
          hint: "不用说出每个词，跟着节奏和语调哼读就好",
        };
      case 2:
        return {
          title: "第 2 轮 · 部分遮盖",
          hint: "文本中部分词已隐藏，边听边补全，完整说出整句",
        };
      case 3:
        return {
          title: "第 3 轮 · 无文本跟读",
          hint: "不看文本，完全跟着声音走",
        };
      default:
        return { title: "", hint: "" };
    }
  };

  const handleStreamReady = useCallback((stream: MediaStream) => {
    silenceRef.current.startMonitoring(stream);
  }, []);

  const handleRecordingComplete = (blob: Blob) => {
    const key = `stage4-round${round}-${Date.now()}`;
    onRecording(key, blob);

    // Stop silence monitoring and check result
    const result = silenceDetection.stopMonitoring();

    const newCompleted = [...roundsCompleted, round];
    setRoundsCompleted(newCompleted);
    setShowOriginal(true);

    if (result.hasLongSilence) {
      onLongSilence();
      if (round === 3) {
        setShowRetryPrompt(true);
      }
    }
  };

  const handleNext = () => {
    setShowOriginal(false);
    if (round < 3) {
      setRound(round + 1);
    } else if (roundsCompleted.includes(3)) {
      onComplete();
    }
  };

  const info = getRoundInfo();
  const displayText = getDisplayText();
  const currentRoundDone = roundsCompleted.includes(round);
  const allDone = [1, 2, 3].every((r) => roundsCompleted.includes(r));

  return (
    <div className="space-y-6">
      <div className="text-center">
        <span className="inline-block px-3 py-1 bg-purple-50 text-purple-600 text-xs font-medium rounded-full mb-2">
          阶段四 · 影子跟读
        </span>
        <p className="text-sm font-medium text-gray-700 mb-1">{info.title}</p>
        <p className="text-xs text-gray-400">{info.hint}</p>
      </div>

      {/* Text display area */}
      {displayText ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-6">
          {displayText}
        </div>
      ) : (
        <div className="bg-gray-100 rounded-2xl p-8 text-center">
          <div className="flex justify-center gap-1">
            {waveHeights.map((h, i) => (
              <div
                key={i}
                className="w-1 bg-purple-400 rounded-full animate-pulse"
                style={{
                  height: `${h}px`,
                  animationDelay: `${i * 0.1}s`,
                }}
              />
            ))}
          </div>
          <p className="text-sm text-gray-400 mt-3">专注聆听，跟着声音走</p>
        </div>
      )}

      {/* Audio player */}
      <AudioPlayer
        src={audioNormalSrc}
        label="常速 1.0x"
      />

      {/* Recorder */}
      <AudioRecorder
        onRecordingComplete={handleRecordingComplete}
        onStreamReady={handleStreamReady}
      />

      {/* Show original text after recording */}
      {showOriginal && (round === 2 || round === 3) && (
        <div className="bg-blue-50 rounded-xl p-4">
          <p className="text-xs text-blue-500 mb-1">原文</p>
          <p className="text-gray-900">{content}</p>
        </div>
      )}

      {/* Retry prompt for round 3 */}
      {showRetryPrompt && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <p className="text-sm text-amber-700 mb-3">
            这句有点难度，再来一遍带文本的？
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => {
                setShowRetryPrompt(false);
                onGoBackToRound2();
              }}
              className="flex-1 py-2 text-sm text-amber-700 border border-amber-300 rounded-lg hover:bg-amber-100"
            >
              好的，回到第 2 轮
            </button>
            <button
              onClick={() => {
                setShowRetryPrompt(false);
                onComplete();
              }}
              className="flex-1 py-2 text-sm text-white bg-amber-600 rounded-lg hover:bg-amber-700"
            >
              没关系，继续
            </button>
          </div>
        </div>
      )}

      {/* Progress */}
      <div className="flex items-center gap-2 justify-center">
        {[1, 2, 3].map((r) => (
          <div
            key={r}
            className={`w-2.5 h-2.5 rounded-full ${
              roundsCompleted.includes(r)
                ? "bg-purple-600"
                : r === round
                ? "bg-purple-300"
                : "bg-gray-200"
            }`}
          />
        ))}
      </div>

      {/* Next button */}
      {currentRoundDone && !showRetryPrompt && (
        <button
          onClick={allDone ? onComplete : handleNext}
          className="w-full py-3 bg-blue-600 text-white font-medium rounded-xl hover:bg-blue-700 transition-colors"
        >
          {allDone ? "进入下一阶段" : "下一轮"}
        </button>
      )}
    </div>
  );
}
