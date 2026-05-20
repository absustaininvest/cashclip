export type VerificationState =
  | { kind: "ok"; status?: number; latencyMs: number; checkedAt: number }
  | { kind: "failed"; status?: number; latencyMs: number; error: string; checkedAt: number }
  | { kind: "unsupported"; reason: string; checkedAt: number };

const states = new Map<string, VerificationState>();

export function setVerificationState(envKey: string, state: VerificationState): void {
  states.set(envKey, state);
}

export function getVerificationState(envKey: string): VerificationState | undefined {
  return states.get(envKey);
}

export function clearVerificationState(envKey: string): void {
  states.delete(envKey);
}

export function isVerifiedConnected(envKey: string): "ok" | "failed" | "unknown" {
  const s = states.get(envKey);
  if (!s) return "unknown";
  if (s.kind === "ok" || s.kind === "unsupported") return "ok";
  return "failed";
}
