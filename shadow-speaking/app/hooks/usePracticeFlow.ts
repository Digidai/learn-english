import { useState, useCallback } from "react";

export type PracticeStage = 1 | 2 | 3 | 4 | 5 | 6;
export type StageStatus = "idle" | "playing" | "recording" | "reviewing" | "completed";

export interface PracticeState {
  stage: PracticeStage;
  round: number;
  status: StageStatus;
  recordings: Map<string, Blob>;
  selfRating: string | null;
  hasLongSilence: boolean;
  startTime: number;
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
  const [state, setState] = useState<PracticeState>({
    stage: 1,
    round: 1,
    status: "idle",
    recordings: new Map(),
    selfRating: null,
    hasLongSilence: false,
    startTime: Date.now(),
  });

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
    setState((prev) => {
      const recordings = new Map(prev.recordings);
      recordings.set(key, blob);
      return { ...prev, recordings };
    });
  }, []);

  const setSelfRating = useCallback((rating: string) => {
    setState((prev) => ({ ...prev, selfRating: rating }));
  }, []);

  const setHasLongSilence = useCallback((value: boolean) => {
    setState((prev) => ({ ...prev, hasLongSilence: value }));
  }, []);

  const nextStage = useCallback(() => {
    setState((prev) => {
      const next = (prev.stage + 1) as PracticeStage;
      if (next > 6) {
        // Practice complete
        const durationSeconds = Math.round((Date.now() - prev.startTime) / 1000);
        const isPoorPerformance =
          prev.selfRating === "poor" || prev.hasLongSilence;

        options.onComplete({
          selfRating: prev.selfRating,
          isPoorPerformance,
          durationSeconds,
          completedAllStages: true,
          recordings: prev.recordings,
        });
        return prev;
      }
      return { ...prev, stage: next, round: 1, status: "idle" };
    });
  }, [options]);

  const exitEarly = useCallback(() => {
    setState((prev) => {
      const durationSeconds = Math.round((Date.now() - prev.startTime) / 1000);
      // Early exit without completing all stages is inherently "poor":
      // no selfRating available yet, so mark isPoorPerformance based on
      // the fact that the user quit mid-flow
      options.onComplete({
        selfRating: prev.selfRating,
        isPoorPerformance: true,
        durationSeconds,
        completedAllStages: false,
        recordings: prev.recordings,
      });
      return prev;
    });
  }, [options]);

  const goBackToRound2 = useCallback(() => {
    setState((prev) => ({
      ...prev,
      stage: 4,
      round: 2,
      status: "idle",
    }));
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
  };
}
