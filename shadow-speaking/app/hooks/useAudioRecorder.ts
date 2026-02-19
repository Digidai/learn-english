import { useState, useRef, useCallback } from "react";

interface UseAudioRecorderOptions {
  onStreamReady?: (stream: MediaStream) => void;
}

interface UseAudioRecorderResult {
  isRecording: boolean;
  recordingBlob: Blob | null;
  recordingUrl: string | null;
  durationMs: number;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<Blob | null>;
  clearRecording: () => void;
}

export function useAudioRecorder(options?: UseAudioRecorderOptions): UseAudioRecorderResult {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingBlob, setRecordingBlob] = useState<Blob | null>(null);
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
  const [durationMs, setDurationMs] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startTimeRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      options?.onStreamReady?.(stream);

      // Choose the best available MIME type
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "audio/mp4";
      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorder.start(100); // Collect data every 100ms
      startTimeRef.current = Date.now();
      setIsRecording(true);
      setRecordingBlob(null);
      setRecordingUrl(null);
    } catch (error) {
      console.error("Failed to start recording:", error);
      throw error;
    }
  }, []);

  const stopRecording = useCallback((): Promise<Blob | null> => {
    return new Promise((resolve) => {
      const recorder = mediaRecorderRef.current;
      if (!recorder || recorder.state === "inactive") {
        resolve(null);
        return;
      }

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
        const url = URL.createObjectURL(blob);
        const elapsed = Date.now() - startTimeRef.current;

        setRecordingBlob(blob);
        setRecordingUrl(url);
        setDurationMs(elapsed);
        setIsRecording(false);

        // Stop all tracks
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;

        resolve(blob);
      };

      recorder.stop();
    });
  }, []);

  const clearRecording = useCallback(() => {
    if (recordingUrl) {
      URL.revokeObjectURL(recordingUrl);
    }
    setRecordingBlob(null);
    setRecordingUrl(null);
    setDurationMs(0);
  }, [recordingUrl]);

  return {
    isRecording,
    recordingBlob,
    recordingUrl,
    durationMs,
    startRecording,
    stopRecording,
    clearRecording,
  };
}
