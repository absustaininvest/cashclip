export type IntegrityResult = {
  clean: boolean;
  reason: string | null;
};

export async function checkDeviceIntegrity(): Promise<IntegrityResult> {
  return { clean: true, reason: null };
}

export function getCachedIntegrity(): IntegrityResult | null {
  return null;
}
