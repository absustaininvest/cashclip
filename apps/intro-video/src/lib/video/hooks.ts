import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    startRecording?: () => void;
    stopRecording?: () => void;
  }
}

interface UseVideoPlayerOptions {
  durations: Record<string, number>;
}

export function useVideoPlayer({ durations }: UseVideoPlayerOptions) {
  const sceneDurations = Object.values(durations);
  const [currentScene, setCurrentScene] = useState(0);
  const startedRef = useRef(false);
  const stoppedRef = useRef(false);

  useEffect(() => {
    if (!startedRef.current) {
      startedRef.current = true;
      window.startRecording?.();
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const scheduleNext = (index: number) => {
      const duration = sceneDurations[index] ?? 3000;
      timer = setTimeout(() => {
        if (cancelled) return;
        const isLast = index === sceneDurations.length - 1;
        if (isLast) {
          if (!stoppedRef.current) {
            stoppedRef.current = true;
            window.stopRecording?.();
          }
          setCurrentScene(0);
          scheduleNext(0);
        } else {
          const next = index + 1;
          setCurrentScene(next);
          scheduleNext(next);
        }
      }, duration);
    };

    scheduleNext(0);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { currentScene };
}
