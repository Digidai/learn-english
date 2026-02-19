import { useState, useRef, useCallback, useEffect } from "react";

interface UseAudioPlayerOptions {
  onEnded?: () => void;
}

export function useAudioPlayer(options: UseAudioPlayerOptions = {}) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [needsManualPlay, setNeedsManualPlay] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playCount, setPlayCount] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Use ref for onEnded to decouple Audio element lifecycle from callback identity
  const onEndedRef = useRef(options.onEnded);
  onEndedRef.current = options.onEnded;

  const stopProgressUpdates = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const startProgressUpdates = useCallback(() => {
    stopProgressUpdates();
    // Use setInterval at ~4fps instead of requestAnimationFrame at 60fps
    intervalRef.current = setInterval(() => {
      if (audioRef.current) {
        setCurrentTime(audioRef.current.currentTime);
      }
    }, 250);
  }, [stopProgressUpdates]);

  useEffect(() => {
    return () => {
      stopProgressUpdates();
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, [stopProgressUpdates]);

  const load = useCallback((src: string) => {
    // Clean up previous audio
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.removeAttribute("src");
      audioRef.current.load();
    }
    stopProgressUpdates();

    if (!src) {
      setHasError(true);
      return;
    }

    setIsLoading(true);
    setHasError(false);

    const audio = new Audio(src);
    audioRef.current = audio;

    audio.addEventListener("loadedmetadata", () => {
      setDuration(audio.duration);
      setIsLoading(false);
    });

    audio.addEventListener("canplaythrough", () => {
      setIsLoading(false);
    });

    audio.addEventListener("ended", () => {
      setIsPlaying(false);
      setPlayCount((c) => c + 1);
      stopProgressUpdates();
      onEndedRef.current?.();
    });

    audio.addEventListener("error", () => {
      setIsPlaying(false);
      setIsLoading(false);
      setHasError(true);
    });

    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
  }, [stopProgressUpdates]);

  const play = useCallback(async () => {
    if (!audioRef.current) return;
    try {
      await audioRef.current.play();
      setIsPlaying(true);
      setHasError(false);
      setNeedsManualPlay(false);
      startProgressUpdates();
    } catch {
      // iOS autoplay restrictions — prompt user to tap to play
      setNeedsManualPlay(true);
    }
  }, [startProgressUpdates]);

  const pause = useCallback(() => {
    if (!audioRef.current) return;
    audioRef.current.pause();
    setIsPlaying(false);
    stopProgressUpdates();
  }, [stopProgressUpdates]);

  const replay = useCallback(async () => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = 0;
    setCurrentTime(0);
    await play();
  }, [play]);

  const seek = useCallback((time: number) => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = time;
    setCurrentTime(time);
  }, []);

  const resetCount = useCallback(() => {
    setPlayCount(0);
  }, []);

  return {
    isPlaying,
    isLoading,
    hasError,
    needsManualPlay,
    currentTime,
    duration,
    playCount,
    load,
    play,
    pause,
    replay,
    seek,
    resetCount,
  };
}
