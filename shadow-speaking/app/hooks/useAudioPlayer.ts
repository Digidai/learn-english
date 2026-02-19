import { useState, useRef, useCallback, useEffect } from "react";

interface UseAudioPlayerOptions {
  onEnded?: () => void;
}

export function useAudioPlayer(options: UseAudioPlayerOptions = {}) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playCount, setPlayCount] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const animFrameRef = useRef<number>(0);
  const isPlayingRef = useRef(false);

  const updateProgress = useCallback(() => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
      if (isPlayingRef.current) {
        animFrameRef.current = requestAnimationFrame(updateProgress);
      }
    }
  }, []);

  useEffect(() => {
    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  const load = useCallback((src: string) => {
    // Clean up previous audio
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.removeAttribute("src");
      audioRef.current.load();
    }
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
    }

    const audio = new Audio(src);
    audioRef.current = audio;

    audio.addEventListener("loadedmetadata", () => {
      setDuration(audio.duration);
    });

    audio.addEventListener("ended", () => {
      isPlayingRef.current = false;
      setIsPlaying(false);
      setPlayCount((c) => c + 1);
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
      options.onEnded?.();
    });

    audio.addEventListener("error", () => {
      isPlayingRef.current = false;
      setIsPlaying(false);
    });

    isPlayingRef.current = false;
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
  }, [options.onEnded]);

  const play = useCallback(async () => {
    if (!audioRef.current) return;
    try {
      await audioRef.current.play();
      isPlayingRef.current = true;
      setIsPlaying(true);
      animFrameRef.current = requestAnimationFrame(updateProgress);
    } catch (e) {
      console.error("Audio play failed:", e);
    }
  }, [updateProgress]);

  const pause = useCallback(() => {
    if (!audioRef.current) return;
    audioRef.current.pause();
    isPlayingRef.current = false;
    setIsPlaying(false);
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
    }
  }, []);

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
