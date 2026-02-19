import { useAudioRecorder } from "~/hooks/useAudioRecorder";

interface AudioRecorderProps {
  onRecordingComplete: (blob: Blob, durationMs: number) => void;
  onStreamReady?: (stream: MediaStream) => void;
  disabled?: boolean;
}

export function AudioRecorder({
  onRecordingComplete,
  onStreamReady,
  disabled,
}: AudioRecorderProps) {
  const recorder = useAudioRecorder({ onStreamReady });

  // Check MediaRecorder support
  const isSupported = typeof MediaRecorder !== "undefined";

  const handleToggle = async () => {
    if (recorder.isRecording) {
      const blob = await recorder.stopRecording();
      if (blob) {
        onRecordingComplete(blob, recorder.durationMs);
      }
    } else {
      await recorder.startRecording();
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
      {/* Record button */}
      <button
        onClick={handleToggle}
        disabled={disabled}
        aria-label={recorder.isRecording ? "停止录音" : "开始录音"}
        className={`w-16 h-16 rounded-full flex items-center justify-center transition-all ${
          recorder.isRecording
            ? "bg-red-500 hover:bg-red-600 animate-pulse"
            : "bg-red-500 hover:bg-red-600"
        } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
      >
        {recorder.isRecording ? (
          <svg className="w-7 h-7 text-white" fill="currentColor" viewBox="0 0 24 24">
            <rect x="6" y="6" width="12" height="12" rx="2" />
          </svg>
        ) : (
          <svg className="w-7 h-7 text-white" fill="currentColor" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="6" />
          </svg>
        )}
      </button>

      <p className="text-xs text-gray-500">
        {recorder.isRecording ? "点击停止录音" : "点击开始录音"}
      </p>

      {/* Playback */}
      {recorder.recordingUrl && !recorder.isRecording && (
        <div className="w-full">
          <audio src={recorder.recordingUrl} controls className="w-full h-10" />
          <p className="text-xs text-gray-400 text-center mt-1">
            录音时长: {(recorder.durationMs / 1000).toFixed(1)}s
          </p>
        </div>
      )}
    </div>
  );
}
