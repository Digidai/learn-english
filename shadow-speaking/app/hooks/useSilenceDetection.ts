import { useState, useRef, useCallback, useEffect } from "react";

interface UseSilenceDetectionResult {
  isSilent: boolean;
  hasLongSilence: boolean; // 3+ seconds continuous silence
  voiceRatio: number; // ratio of voice time to total time
  startMonitoring: (stream: MediaStream) => void;
  stopMonitoring: () => { isSilent: boolean; hasLongSilence: boolean; voiceRatio: number };
  reset: () => void;
}

const SILENCE_THRESHOLD = 15; // amplitude threshold (0-255)
const SAMPLE_INTERVAL = 100; // ms
const LONG_SILENCE_DURATION = 3000; // 3 seconds

export function useSilenceDetection(): UseSilenceDetectionResult {
  const [isSilent, setIsSilent] = useState(false);
  const [hasLongSilence, setHasLongSilence] = useState(false);
  const [voiceRatio, setVoiceRatio] = useState(0);

  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const voiceSamplesRef = useRef(0);
  const totalSamplesRef = useRef(0);
  const silenceStartRef = useRef<number | null>(null);
  const longSilenceDetectedRef = useRef(false);

  const startMonitoring = useCallback((stream: MediaStream) => {
    // Close existing context before creating a new one
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    const audioContext = new AudioContext();
    // Resume context for iOS Safari where AudioContext starts suspended
    if (audioContext.state === "suspended") {
      audioContext.resume();
    }
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);

    audioContextRef.current = audioContext;
    analyserRef.current = analyser;
    voiceSamplesRef.current = 0;
    totalSamplesRef.current = 0;
    silenceStartRef.current = null;
    longSilenceDetectedRef.current = false;
    setHasLongSilence(false);
    setIsSilent(false);

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    let lastRatioUpdate = 0;

    intervalRef.current = setInterval(() => {
      analyser.getByteFrequencyData(dataArray);
      const average = dataArray.reduce((sum, val) => sum + val, 0) / dataArray.length;

      totalSamplesRef.current++;

      if (average > SILENCE_THRESHOLD) {
        voiceSamplesRef.current++;
        silenceStartRef.current = null;
        setIsSilent(false);
      } else {
        setIsSilent(true);
        if (silenceStartRef.current === null) {
          silenceStartRef.current = Date.now();
        } else if (
          Date.now() - silenceStartRef.current >= LONG_SILENCE_DURATION &&
          !longSilenceDetectedRef.current
        ) {
          longSilenceDetectedRef.current = true;
          setHasLongSilence(true);
        }
      }

      // Throttle voiceRatio updates to every 500ms
      const now = Date.now();
      if (now - lastRatioUpdate >= 500) {
        lastRatioUpdate = now;
        const ratio =
          totalSamplesRef.current > 0
            ? voiceSamplesRef.current / totalSamplesRef.current
            : 0;
        setVoiceRatio(ratio);
      }
    }, SAMPLE_INTERVAL);
  }, []);

  const stopMonitoring = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    const ratio =
      totalSamplesRef.current > 0
        ? voiceSamplesRef.current / totalSamplesRef.current
        : 0;

    // Silent if less than 10% voice
    const silent = ratio < 0.1;

    return {
      isSilent: silent,
      hasLongSilence: longSilenceDetectedRef.current,
      voiceRatio: ratio,
    };
  }, []);

  const reset = useCallback(() => {
    stopMonitoring();
    setIsSilent(false);
    setHasLongSilence(false);
    setVoiceRatio(0);
  }, [stopMonitoring]);

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (audioContextRef.current) audioContextRef.current.close();
    };
  }, []);

  return {
    isSilent,
    hasLongSilence,
    voiceRatio,
    startMonitoring,
    stopMonitoring,
    reset,
  };
}
