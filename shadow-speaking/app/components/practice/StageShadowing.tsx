import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useAudioPlayer } from "~/hooks/useAudioPlayer";
import { useAudioRecorder } from "~/hooks/useAudioRecorder";
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
  const [shadowingActive, setShadowingActive] = useState(false);
  const [autoStopCountdown, setAutoStopCountdown] = useState<number | null>(null);
  const silenceDetection = useSilenceDetection();
  const silenceRef = useRef(silenceDetection);
  silenceRef.current = silenceDetection;

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

  const handleRecordingCompleteRef = useRef(handleRecordingComplete);
  handleRecordingCompleteRef.current = handleRecordingComplete;

  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Unified audio player + recorder for simultaneous play+record
  const player = useAudioPlayer({
    onEnded: () => {
      // Audio ended — start 4s countdown to auto-stop recording
      setAutoStopCountdown(4);
      countdownIntervalRef.current = setInterval(() => {
        setAutoStopCountdown((prev) => {
          if (prev === null || prev <= 1) {
            if (countdownIntervalRef.current) {
              clearInterval(countdownIntervalRef.current);
              countdownIntervalRef.current = null;
            }
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      autoStopTimerRef.current = setTimeout(async () => {
        if (recorderRef.current.isRecording) {
          const result = await recorder.stopRecording();
          if (result) {
            handleRecordingCompleteRef.current(result.blob);
          }
        }
        setShadowingActive(false);
        setAutoStopCountdown(null);
      }, 4000);
    },
  });
  const recorder = useAudioRecorder({
    onStreamReady: (stream: MediaStream) => {
      silenceRef.current.startMonitoring(stream);
    },
  });
  const recorderRef = useRef(recorder);
  recorderRef.current = recorder;
  const autoStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup auto-stop timer
  useEffect(() => {
    return () => {
      if (autoStopTimerRef.current) clearTimeout(autoStopTimerRef.current);
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
    };
  }, []);

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

  // Load audio source when it changes
  useEffect(() => {
    if (audioNormalSrc) {
      player.load(audioNormalSrc);
    }
  }, [audioNormalSrc]);

  const startShadowing = useCallback(async () => {
    try {
      await recorder.startRecording();
      navigator.vibrate?.(50);
      // Start audio playback alongside recording
      player.replay();
      setShadowingActive(true);
      if (autoStopTimerRef.current) {
        clearTimeout(autoStopTimerRef.current);
        autoStopTimerRef.current = null;
      }
    } catch {
      // Permission denied — recorder handles state internally
    }
  }, [recorder, player]);

  const stopShadowingManually = useCallback(async () => {
    if (autoStopTimerRef.current) {
      clearTimeout(autoStopTimerRef.current);
      autoStopTimerRef.current = null;
    }
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
    player.pause();
    navigator.vibrate?.(50);
    const result = await recorder.stopRecording();
    if (result) {
      handleRecordingCompleteRef.current(result.blob);
    }
    setShadowingActive(false);
    setAutoStopCountdown(null);
  }, [recorder, player]);

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
        <h2 className="inline-block px-3 py-1 bg-purple-50 text-purple-600 text-xs font-medium rounded-full mb-2">
          阶段四 · 影子跟读
        </h2>
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

      {/* Unified shadowing control */}
      {!currentRoundDone && (
        <div className="flex flex-col items-center gap-3">
          {shadowingActive ? (
            <>
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 bg-red-500 rounded-full animate-pulse" />
                <span className="text-sm text-red-600 font-medium">跟读中...</span>
              </div>
              <button
                onClick={stopShadowingManually}
                className="w-full py-3 bg-red-500 text-white font-medium rounded-xl hover:bg-red-600 transition-colors active:scale-95"
              >
                停止跟读
              </button>
              {!player.isPlaying && (
                <p className="text-xs text-amber-600">
                  {autoStopCountdown !== null
                    ? `还有 ${autoStopCountdown} 秒自动停止`
                    : "音频已结束，可以继续说完或点击停止"}
                </p>
              )}
            </>
          ) : (
            <button
              onClick={startShadowing}
              className="w-full py-3 bg-purple-600 text-white font-medium rounded-xl hover:bg-purple-700 transition-colors active:scale-95"
            >
              开始跟读
            </button>
          )}
        </div>
      )}

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
