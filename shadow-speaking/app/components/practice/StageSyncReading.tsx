import { useState, useCallback } from "react";
import { AudioPlayer } from "~/components/audio/AudioPlayer";
import { AudioRecorder } from "~/components/audio/AudioRecorder";

interface Props {
  content: string;
  pauseMarks: number[];
  audioSlowSrc: string;
  audioNormalSrc: string;
  onRecording: (key: string, blob: Blob) => void;
  onComplete: () => void;
}

type Phase = "listen" | "record" | "review";

export function StageSyncReading({
  content,
  pauseMarks,
  audioSlowSrc,
  audioNormalSrc,
  onRecording,
  onComplete,
}: Props) {
  const [round, setRound] = useState(1); // 1=slow, 2=normal
  const [roundsCompleted, setRoundsCompleted] = useState(0);
  const [extraRounds, setExtraRounds] = useState(0);
  const [phase, setPhase] = useState<Phase>("listen");
  const [silentWarning, setSilentWarning] = useState(false);

  const words = content.split(" ");
  const displayContent = words.map((word, i) => {
    const hasPause = pauseMarks.includes(i);
    return (
      <span key={i}>
        {word}
        {hasPause ? <span className="text-blue-400"> | </span> : " "}
      </span>
    );
  });

  const currentAudio = round === 1 ? audioSlowSrc : audioNormalSrc;
  const roundLabel = round === 1
    ? "第 1 遍 · 慢速"
    : `第 ${roundsCompleted >= 2 ? roundsCompleted + 1 : 2} 遍 · 常速`;

  const handleAudioEnded = useCallback(() => {
    // Audio finished → switch to record phase
    setPhase("record");
  }, []);

  const handleRecordingComplete = (blob: Blob, durationMs: number) => {
    // Simple silence check: if duration is very short, might be silent
    if (durationMs < 500) {
      setSilentWarning(true);
      return;
    }

    setSilentWarning(false);
    const key = `stage3-round${round}-${Date.now()}`;
    onRecording(key, blob);

    const newCompleted = roundsCompleted + 1;
    setRoundsCompleted(newCompleted);
    setPhase("review");

    if (newCompleted === 1) {
      // Move to normal speed after first round
      setRound(2);
    }
  };

  const handleNextRound = () => {
    setPhase("listen");
    setSilentWarning(false);
  };

  const canComplete = roundsCompleted >= 2;
  const canExtraRound = canComplete && extraRounds < 3;

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="inline-block px-3 py-1 bg-blue-50 text-blue-600 text-xs font-medium rounded-full mb-2">
          阶段三 · 同步跟读
        </h2>
        <p className="text-sm text-gray-500 mb-1">{roundLabel}</p>
        <p className="text-xs text-gray-400">
          {phase === "listen"
            ? "先听一遍音频"
            : phase === "record"
            ? "现在跟着朗读"
            : "录音完成"}
        </p>
      </div>

      {/* Text with pause marks */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6">
        <p className="text-xl font-medium text-gray-900 leading-relaxed">
          {displayContent}
        </p>
      </div>

      {/* Listen phase: audio player */}
      {phase === "listen" && (
        <>
          <AudioPlayer
            src={currentAudio}
            label={round === 1 ? "慢速 0.75x" : "常速 1.0x"}
            onEnded={handleAudioEnded}
            autoPlay
          />
          <div className="bg-blue-50 rounded-xl p-3">
            <p className="text-xs text-blue-600 text-center">
              先认真听一遍，听完后自动进入录音
            </p>
          </div>
        </>
      )}

      {/* Record phase: recorder */}
      {phase === "record" && (
        <>
          <div className="bg-amber-50 rounded-xl p-3">
            <p className="text-xs text-amber-600 text-center">
              看着文本，大声朗读出来
            </p>
          </div>
          <AudioRecorder onRecordingComplete={handleRecordingComplete} />
        </>
      )}

      {/* Review phase: show result */}
      {phase === "review" && !canComplete && (
        <button
          onClick={handleNextRound}
          className="w-full py-3 bg-blue-600 text-white font-medium rounded-xl hover:bg-blue-700 transition-colors"
        >
          下一遍
        </button>
      )}

      {silentWarning && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <p className="text-sm text-red-700 mb-3">
            没有检测到声音，请大声跟读。跟读时出声是练习有效的关键。
          </p>
          <button
            onClick={() => {
              setSilentWarning(false);
              setPhase("record");
            }}
            className="w-full py-2 text-sm text-red-700 border border-red-300 rounded-lg hover:bg-red-100 transition-colors"
          >
            重新录音
          </button>
        </div>
      )}

      {/* Progress */}
      <div className="flex items-center justify-center gap-2">
        {[1, 2].map((r) => (
          <div
            key={r}
            className={`w-2.5 h-2.5 rounded-full ${
              r <= roundsCompleted
                ? "bg-blue-600"
                : r === roundsCompleted + 1
                ? "bg-blue-300"
                : "bg-gray-200"
            }`}
          />
        ))}
        <span className="text-xs text-gray-400 ml-1">{roundsCompleted}/2</span>
      </div>

      {canComplete && phase === "review" && (
        <div className="space-y-2">
          <button
            onClick={onComplete}
            className="w-full py-3 bg-blue-600 text-white font-medium rounded-xl hover:bg-blue-700 transition-colors"
          >
            进入下一阶段
          </button>
          {canExtraRound && (
            <button
              onClick={() => {
                setExtraRounds((e) => e + 1);
                setRound(2);
                setPhase("listen");
              }}
              className="w-full py-2.5 text-blue-600 border border-blue-200 font-medium rounded-xl hover:bg-blue-50 transition-colors"
            >
              再练一遍（常速）
            </button>
          )}
        </div>
      )}
    </div>
  );
}
