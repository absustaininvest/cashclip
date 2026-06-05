import React, { createContext, useCallback, useContext, useRef, useState } from "react";
import CelebrationOverlay, { type CelebrationTier } from "@/components/CelebrationOverlay";

/**
 * CelebrationContext — app-wide "fire a celebration" hook. Any screen can call
 * celebrate() at a genuine win moment (spin win, streak milestone, mission/goal
 * completed, bonus game win, big cash-out) and Chipley sprints across the screen
 * with confetti/fireworks. Mount <CelebrationProvider> once near the app root,
 * wrapping the navigator, so the overlay paints above every screen.
 */

export interface CelebrationOptions {
  tier?: CelebrationTier;
  label?: string;
  title?: string;
}

interface CelebrationRun {
  id: number;
  tier: CelebrationTier;
  label?: string;
  title?: string;
}

interface CelebrationContextValue {
  celebrate: (opts?: CelebrationOptions) => void;
}

const CelebrationContext = createContext<CelebrationContextValue>({
  celebrate: () => {},
});

export function useCelebration(): CelebrationContextValue {
  return useContext(CelebrationContext);
}

export function CelebrationProvider({ children }: { children: React.ReactNode }) {
  const [run, setRun] = useState<CelebrationRun | null>(null);
  const idRef = useRef(0);

  const celebrate = useCallback((opts?: CelebrationOptions) => {
    idRef.current += 1;
    setRun({
      id: idRef.current,
      tier: opts?.tier ?? "nice",
      label: opts?.label,
      title: opts?.title,
    });
  }, []);

  const handleDone = useCallback((doneId: number) => {
    setRun((cur) => (cur && cur.id === doneId ? null : cur));
  }, []);

  return (
    <CelebrationContext.Provider value={{ celebrate }}>
      {children}
      {run && (
        <CelebrationOverlay
          key={run.id}
          runId={run.id}
          tier={run.tier}
          label={run.label}
          title={run.title}
          onDone={handleDone}
        />
      )}
    </CelebrationContext.Provider>
  );
}
