export async function getATTStatus(): Promise<string> {
  try {
    const { getTrackingPermissionsAsync } = require("expo-tracking-transparency");
    const result = await Promise.race([
      getTrackingPermissionsAsync(),
      new Promise<{ status: string }>((r) =>
        setTimeout(() => r({ status: "unavailable" }), 3000)
      ),
    ]);
    return (result as { status: string }).status;
  } catch {
    return "unavailable";
  }
}

export async function requestATT(): Promise<void> {
  try {
    const { requestTrackingPermissionsAsync } = require("expo-tracking-transparency");
    await requestTrackingPermissionsAsync();
  } catch {}
}
