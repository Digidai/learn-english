import { useState } from "react";
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
  const [isRecordingPhase, setIsRecordingPhase] = useState(false);
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
  const roundLabel = round === 1 ? "第 1 遍 · 慢速" : `第 ${roundsCompleted >= 2 ? roundsCompleted + 1 : 2} 遍 · 常速`;

  const handleRecordingComplete = (blob: Blob, durationMs: number) => {
    // Simple silence check: if duration is very short, might be silent
    if (durationMs < 500) {
      setSilentWarning(true);
      return;
    }

    setSilentWarning(false);
    const key = `stage3-round${round}-${Date.now()}`;
    onRecording(key, blob);
    setIsRecordingPhase(false);

    const newCompleted = roundsCompleted + 1;
    setRoundsCompleted(newCompleted);

    if (newCompleted === 1) {
      // Move to normal speed
      setRound(2);
    }
  };

  const canComplete = roundsCompleted >= 2;
  const canExtraRound = canComplete && extraRounds < 3;

  return (
    <div className="space-y-6">
      <div className="text-center">
        <span className="inline-block px-3 py-1 bg-blue-50 text-blue-600 text-xs font-medium rounded-full mb-2">
          阶段三 · 同步跟读
        </span>
        <p className="text-sm text-gray-500 mb-1">{roundLabel}</p>
        <p className="text-xs text-gray-400">
          看着文本，跟着音频一起朗读
        </p>
      </div>

      {/* Text with pause marks */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6">
        <p className="text-xl font-medium text-gray-900 leading-relaxed">
          {displayContent}
        </p>
      </div>

      {/* Audio player */}
      <AudioPlayer
        src={currentAudio}
        label={round === 1 ? "慢速 0.75x" : "常速 1.0x"}
        onEnded={() => setIsRecordingPhase(false)}
      />

      {/* Recording indicator */}
      {isRecordingPhase && (
        <div className="flex items-center justify-center gap-2 text-red-500">
          <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
          <span className="text-sm font-medium">录音中</span>
        </div>
      )}

      {/* Recorder */}
      <AudioRecorder
        onRecordingComplete={handleRecordingComplete}
      />

      {silentWarning && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <p className="text-sm text-red-700">
            没有检测到声音，请大声跟读。跟读时出声是练习有效的关键。
          </p>
        </div>
      )}

      {/* Progress and next */}
      <div className="flex items-center justify-between text-sm text-gray-500">
        <span>已完成 {roundsCompleted}/2 遍</span>
      </div>

      {canComplete && (
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
