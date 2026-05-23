import { secureGet, secureSet } from "./secure-store";

const KEY = "cashclip_device_id_v1";

let cached: string | null = null;
let inflight: Promise<string> | null = null;

function newId(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export async function getDeviceId(): Promise<string> {
  if (cached) return cached;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const existing = await secureGet(KEY);
      if (existing && /^[0-9a-f-]{36}$/i.test(existing)) {
        cached = existing;
        return existing;
      }
    } catch {}
    const fresh = newId();
    try { await secureSet(KEY, fresh); } catch {}
    cached = fresh;
    return fresh;
  })();
  try { return await inflight; } finally { inflight = null; }
}
