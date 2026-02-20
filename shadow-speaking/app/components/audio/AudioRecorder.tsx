import { useState, useRef, useEffect, useCallback } from "react";
import { useAudioRecorder } from "~/hooks/useAudioRecorder";
import { AudioPlayer } from "~/components/audio/AudioPlayer";

interface AudioRecorderProps {
  onRecordingComplete: (blob: Blob, durationMs: number) => void;
  onStreamReady?: (stream: MediaStream) => void;
  disabled?: boolean;
}

const MAX_RECORDING_SECONDS = 60;

export function AudioRecorder({
  onRecordingComplete,
  onStreamReady,
  disabled,
}: AudioRecorderProps) {
  const recorder = useAudioRecorder({ onStreamReady });
  const [permError, setPermError] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recorderRef = useRef(recorder);
  recorderRef.current = recorder;

  // Check MediaRecorder support
  const isSupported = typeof MediaRecorder !== "undefined";

  // Stable stop handler for auto-stop
  const handleStop = useCallback(async () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    navigator.vibrate?.(50);
    const result = await recorderRef.current.stopRecording();
    if (result) {
      onRecordingComplete(result.blob, result.durationMs);
    }
    setElapsedSeconds(0);
  }, [onRecordingComplete]);

  // Timer interval during recording + auto-stop at max duration
  useEffect(() => {
    if (recorder.isRecording) {
      setElapsedSeconds(0);
      timerRef.current = setInterval(() => {
        setElapsedSeconds((prev) => {
          const next = prev + 1;
          if (next >= MAX_RECORDING_SECONDS) {
            handleStop();
          }
          return next;
        });
      }, 1000);
    }
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [recorder.isRecording, handleStop]);

  const formatTimer = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const handleToggle = async () => {
    if (recorder.isRecording) {
      await handleStop();
    } else {
      try {
        setPermError(false);
        await recorder.startRecording();
        navigator.vibrate?.(50);
      } catch {
        // Permission denied or other error — show message
        setPermError(true);
      }
    }
  };

  if (!isSupported) {
    return (
      <div className="flex flex-col items-center gap-3">
        <p className="text-sm text-red-500">
          你的浏览器不支持录音功能，请使用 Chrome 或 Safari。
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3">
      {/* Permission denied message */}
      {(permError || recorder.permissionDenied) && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 w-full">
          <p className="text-sm text-red-700 text-center">
            需要麦克风权限才能录音。请在浏览器设置中允许麦克风访问。
          </p>
        </div>
      )}

      {/* Recording indicator */}
      {recorder.isRecording && (
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 bg-red-500 rounded-full animate-pulse" />
          <span className="text-sm font-mono text-red-600">{formatTimer(elapsedSeconds)}</span>
          <span className="text-xs text-gray-400">/ {formatTimer(MAX_RECORDING_SECONDS)}</span>
        </div>
      )}

      {/* Record button */}
      <div className="relative">
        {recorder.isRecording && (
          <div className="absolute inset-0 bg-red-500 rounded-full animate-ping opacity-20" />
        )}
        <button
          onClick={handleToggle}
          disabled={disabled}
          aria-label={recorder.isRecording ? "停止录音" : "开始录音"}
          aria-pressed={recorder.isRecording}
          className={`relative z-10 w-16 h-16 rounded-full flex items-center justify-center transition-all active:scale-95 ${
            recorder.isRecording
              ? "bg-red-500 hover:bg-red-600 shadow-lg shadow-red-200"
              : "bg-blue-600 hover:bg-blue-700 shadow-lg shadow-blue-100"
          } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
        >
          {recorder.isRecording ? (
            <svg className="w-7 h-7 text-white" fill="currentColor" viewBox="0 0 24 24">
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
          ) : (
            <svg className="w-7 h-7 text-white" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
              <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
            </svg>
          )}
        </button>
      </div>

      <p className="text-xs font-medium text-gray-500">
        {recorder.isRecording ? "正在录音 · 点击停止" : "准备好了 · 点击开始"}
      </p>

      {/* Playback */}
      {recorder.recordingUrl && !recorder.isRecording && (
        <div className="w-full">
          <AudioPlayer src={recorder.recordingUrl} label="录音回放" />
          <p className="text-xs text-gray-400 text-center mt-1">
            录音时长: {(recorder.durationMs / 1000).toFixed(1)}s
          </p>
        </div>
      )}
    </div>
  );
}
