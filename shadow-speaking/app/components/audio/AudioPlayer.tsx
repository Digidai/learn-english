import { useEffect } from "react";
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
    player.load(src);
    if (autoPlay) {
      // Small delay for UX
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

  return (
    <div className="bg-gray-50 rounded-xl p-4">
      {label && (
        <p className="text-xs text-gray-500 mb-2">{label}</p>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={player.isPlaying ? player.pause : player.play}
          aria-label={player.isPlaying ? "暂停" : "播放"}
          className="w-10 h-10 bg-blue-600 text-white rounded-full flex items-center justify-center hover:bg-blue-700 transition-colors shrink-0"
        >
          {player.isPlaying ? (
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
          <div
            className="h-1.5 bg-gray-200 rounded-full overflow-hidden cursor-pointer"
            onClick={handleSeek}
            role="slider"
            aria-label="播放进度"
            aria-valuenow={Math.round(player.currentTime)}
            aria-valuemin={0}
            aria-valuemax={Math.round(player.duration)}
            tabIndex={0}
          >
            <div
              className="h-full bg-blue-600 rounded-full transition-all duration-100"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="flex justify-between mt-1">
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
