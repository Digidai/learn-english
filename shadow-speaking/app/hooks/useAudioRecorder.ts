import { useState, useRef, useCallback, useEffect } from "react";

interface UseAudioRecorderOptions {
  onStreamReady?: (stream: MediaStream) => void;
}

export interface UseAudioRecorderResult {
  isRecording: boolean;
  recordingBlob: Blob | null;
  recordingUrl: string | null;
  durationMs: number;
  /** The actual MIME type used by MediaRecorder (may be audio/mp4 on iOS) */
  mimeType: string;
  permissionDenied: boolean;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<{ blob: Blob; durationMs: number } | null>;
  clearRecording: () => void;
}

export function useAudioRecorder(options?: UseAudioRecorderOptions): UseAudioRecorderResult {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingBlob, setRecordingBlob] = useState<Blob | null>(null);
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
  const [durationMs, setDurationMs] = useState(0);
  const [mimeType, setMimeType] = useState("audio/webm;codecs=opus");
  const [permissionDenied, setPermissionDenied] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startTimeRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // Cleanup on unmount — stop tracks if still recording
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
    };
  }, []);

  const startRecording = useCallback(async () => {
    try {
      setPermissionDenied(false);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      optionsRef.current?.onStreamReady?.(stream);

      // Choose the best available MIME type
      const chosenMime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "audio/mp4";
      setMimeType(chosenMime);

      const mediaRecorder = new MediaRecorder(stream, { mimeType: chosenMime });
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
    } catch (error: unknown) {
      // Check for permission denial
      if (error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "PermissionDeniedError")) {
        setPermissionDenied(true);
      }
      throw error;
    }
  }, []);

  const stopRecording = useCallback((): Promise<{ blob: Blob; durationMs: number } | null> => {
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

        resolve({ blob, durationMs: elapsed });
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
    mimeType,
    permissionDenied,
    startRecording,
    stopRecording,
    clearRecording,
  };
}
