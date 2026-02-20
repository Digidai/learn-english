import { useState, useCallback, useRef, useEffect } from "react";

export type PracticeStage = 1 | 2 | 3 | 4 | 5 | 6;
export type StageStatus = "idle" | "playing" | "recording" | "reviewing" | "completed";

export interface PracticeState {
  stage: PracticeStage;
  round: number;
  status: StageStatus;
  selfRating: string | null;
  hasLongSilence: boolean;
  startTime: number;
  /** Set to true when flow reaches completion — triggers onComplete via useEffect */
  finished: "normal" | "early" | null;
}

interface UsePracticeFlowOptions {
  onComplete: (data: {
    selfRating: string | null;
    isPoorPerformance: boolean;
    durationSeconds: number;
    completedAllStages: boolean;
    recordings: Map<string, Blob>;
  }) => void;
}

export function usePracticeFlow(options: UsePracticeFlowOptions) {
  // Use ref for onComplete to avoid recreating callbacks when parent re-renders
  const onCompleteRef = useRef(options.onComplete);
  onCompleteRef.current = options.onComplete;

  // Store recordings in a ref — nothing renders based on blob contents
  const recordingsRef = useRef<Map<string, Blob>>(new Map());

  const [state, setState] = useState<PracticeState>({
    stage: 1,
    round: 1,
    status: "idle",
    selfRating: null,
    hasLongSilence: false,
    startTime: Date.now(),
    finished: null,
  });

  // Fire onComplete as a side effect (not inside setState updater)
  useEffect(() => {
    if (!state.finished) return;
    const durationSeconds = Math.round((Date.now() - state.startTime) / 1000);
    const isEarly = state.finished === "early";
    const isPoorPerformance = isEarly || state.selfRating === "poor" || state.hasLongSilence;

    onCompleteRef.current({
      selfRating: state.selfRating,
      isPoorPerformance,
      durationSeconds,
      completedAllStages: !isEarly,
      recordings: recordingsRef.current,
    });
  }, [state.finished]);

  const goToStage = useCallback((stage: PracticeStage) => {
    setState((prev) => ({
      ...prev,
      stage,
      round: 1,
      status: "idle",
    }));
  }, []);

  const setRound = useCallback((round: number) => {
    setState((prev) => ({ ...prev, round, status: "idle" }));
  }, []);

  const setStatus = useCallback((status: StageStatus) => {
    setState((prev) => ({ ...prev, status }));
  }, []);

  const addRecording = useCallback((key: string, blob: Blob) => {
    recordingsRef.current.set(key, blob);
  }, []);

  const setSelfRating = useCallback((rating: string) => {
    setState((prev) => ({ ...prev, selfRating: rating }));
  }, []);

  const setHasLongSilence = useCallback((value: boolean) => {
    setState((prev) => ({ ...prev, hasLongSilence: value }));
  }, []);

  const nextStage = useCallback(() => {
    setState((prev) => {
      if (prev.finished) return prev;
      const next = (prev.stage + 1) as PracticeStage;
      if (next > 6) {
        // Signal completion — useEffect will fire onComplete
        return { ...prev, finished: "normal" as const };
      }
      return { ...prev, stage: next, round: 1, status: "idle" };
    });
  }, []);

  const exitEarly = useCallback(() => {
    setState((prev) => {
      if (prev.finished) return prev;
      return { ...prev, finished: "early" as const };
    });
  }, []);

  const goBackToRound2 = useCallback(() => {
    setState((prev) => ({
      ...prev,
      stage: 4,
      round: 2,
      status: "idle",
    }));
  }, []);

  const resetCompletion = useCallback(() => {
    setState((prev) => {
      if (!prev.finished) return prev;
      return { ...prev, finished: null, startTime: Date.now() };
    });
  }, []);

  return {
    state,
    goToStage,
    setRound,
    setStatus,
    addRecording,
    setSelfRating,
    setHasLongSilence,
    nextStage,
    exitEarly,
    goBackToRound2,
    resetCompletion,
  };
}
