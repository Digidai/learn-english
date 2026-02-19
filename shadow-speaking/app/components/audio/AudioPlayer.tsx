import { useEffect, useCallback } from "react";
import { useAudioPlayer } from "~/hooks/useAudioPlayer";

interface AudioPlayerProps {
  src: string;
  label?: string;
  onEnded?: () => void;
  autoPlay?: boolean;
  showCount?: boolean;
}

export function AudioPlayer({ src, label, onEnded, autoPlay, showCount }: AudioPlayerProps) {
  const player = useAudioPlayer({ onEnded });

  useEffect(() => {
    if (!src) return;
    player.load(src);
    if (autoPlay) {
      // Small delay for UX — but only works with user gesture on iOS
      const timer = setTimeout(() => player.play(), 300);
      return () => clearTimeout(timer);
    }
  }, [src]);

  const progress = player.duration > 0 ? (player.currentTime / player.duration) * 100 : 0;

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (player.duration <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    player.seek(ratio * player.duration);
  };

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (player.duration <= 0) return;
      if (e.key === "ArrowRight") {
        player.seek(Math.min(player.duration, player.currentTime + 5));
      } else if (e.key === "ArrowLeft") {
        player.seek(Math.max(0, player.currentTime - 5));
      }
    },
    [player.duration, player.currentTime]
  );

  // Error state
  if (player.hasError && !player.isLoading) {
    return (
      <div className="bg-gray-50 rounded-xl p-4">
        {label && <p className="text-xs text-gray-500 mb-2">{label}</p>}
        <div className="flex items-center justify-between">
          <p className="text-sm text-red-500">音频加载失败</p>
          <button
            onClick={() => { player.load(src); }}
            className="text-xs text-blue-600 hover:text-blue-700"
          >
            重试
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-50 rounded-xl p-4 relative">
      {label && (
        <p className="text-xs text-gray-500 mb-2">{label}</p>
      )}

      {/* iOS autoplay fallback overlay */}
      {player.needsManualPlay && (
        <div className="absolute inset-0 bg-white/90 rounded-xl flex items-center justify-center z-10">
          <button
            onClick={player.play}
            className="flex items-center gap-2 px-5 py-3 bg-blue-600 text-white font-medium rounded-xl hover:bg-blue-700 transition-colors"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
            点击播放
          </button>
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={player.isPlaying ? player.pause : player.play}
          disabled={player.isLoading}
          aria-label={player.isPlaying ? "暂停" : "播放"}
          className="w-10 h-10 bg-blue-600 text-white rounded-full flex items-center justify-center hover:bg-blue-700 transition-colors shrink-0 disabled:opacity-50"
        >
          {player.isLoading ? (
            <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : player.isPlaying ? (
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
            </svg>
          ) : (
            <svg className="w-5 h-5 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>

        <div className="flex-1">
          {/* Enlarged touch target for seek bar */}
          <div
            className="py-2 cursor-pointer"
            onClick={handleSeek}
            onKeyDown={handleKeyDown}
            role="slider"
            aria-label="播放进度"
            aria-valuenow={Math.round(player.currentTime)}
            aria-valuemin={0}
            aria-valuemax={Math.round(player.duration)}
            tabIndex={0}
          >
            <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-600 rounded-full transition-all duration-200"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
          <div className="flex justify-between">
            <span className="text-xs text-gray-400">{formatTime(player.currentTime)}</span>
            <span className="text-xs text-gray-400">{formatTime(player.duration)}</span>
          </div>
        </div>

        {showCount && (
          <span className="text-xs text-gray-500 shrink-0">
            {player.playCount}次
          </span>
        )}
      </div>

      <div className="flex gap-2 mt-2">
        <button
          onClick={player.replay}
          className="text-xs text-blue-600 hover:text-blue-700"
        >
          重新播放
        </button>
      </div>
    </div>
  );
}
