import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { secureGet } from "./secure-store";
import { getApiUrl } from "./query-client";

export type AdEventType =
  | "impression"
  | "completion"
  | "reward_earned"
  | "load_failed"
  | "clicked";

export type AdUnitType = "rewarded" | "interstitial" | "banner";

interface AdEventPayload {
  event: AdEventType;
  adUnitType: AdUnitType;
  rewardAmount?: number;
  rewardType?: string;
  errorCode?: string;
  errorMessage?: string;
  durationMs?: number;
  revenueMicros?: number;
}

const EVENT_QUEUE_KEY = "cashclip_ad_event_queue";
const FLUSH_INTERVAL_MS = 30_000;
const MAX_QUEUE_SIZE = 100;

let flushTimer: ReturnType<typeof setInterval> | null = null;
let flushing = false;

function getPlatformName(): string {
  return Platform.OS;
}

async function getAuthToken(): Promise<string | null> {
  return secureGet("cashclip_auth_token");
}

async function enqueue(payload: AdEventPayload): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(EVENT_QUEUE_KEY);
    const queue: AdEventPayload[] = raw ? JSON.parse(raw) : [];
    queue.push(payload);
    if (queue.length > MAX_QUEUE_SIZE) {
      queue.splice(0, queue.length - MAX_QUEUE_SIZE);
    }
    await AsyncStorage.setItem(EVENT_QUEUE_KEY, JSON.stringify(queue));
  } catch {
  }
}

const BATCH_SIZE = 50;

async function flushQueue(): Promise<void> {
  if (flushing) return;
  flushing = true;

  try {
    const raw = await AsyncStorage.getItem(EVENT_QUEUE_KEY);
    if (!raw) return;

    const queue: AdEventPayload[] = JSON.parse(raw);
    if (queue.length === 0) return;

    const token = await getAuthToken();
    if (!token) return;

    const baseUrl = getApiUrl();
    const url = new URL("api/ad-events/batch", baseUrl);
    const platform = getPlatformName();

    let totalSent = 0;

    for (let i = 0; i < queue.length; i += BATCH_SIZE) {
      const chunk = queue.slice(i, i + BATCH_SIZE);
      const events = chunk.map((e) => ({ ...e, platform }));

      try {
        const res = await fetch(url.toString(), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ events }),
        });

        if (res.ok) {
          totalSent += chunk.length;
        } else {
          break;
        }
      } catch {
        break;
      }
    }

    if (totalSent >= queue.length) {
      await AsyncStorage.removeItem(EVENT_QUEUE_KEY);
    } else if (totalSent > 0) {
      const remaining = queue.slice(totalSent);
      await AsyncStorage.setItem(EVENT_QUEUE_KEY, JSON.stringify(remaining));
    }
  } catch {
  } finally {
    flushing = false;
  }
}

export function startAdAnalyticsFlush(): void {
  if (flushTimer) return;
  flushTimer = setInterval(flushQueue, FLUSH_INTERVAL_MS);
}

export function stopAdAnalyticsFlush(): void {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  flushQueue();
}

export async function trackAdImpression(adUnitType: AdUnitType): Promise<void> {
  await enqueue({ event: "impression", adUnitType });
}

export async function trackAdCompletion(adUnitType: AdUnitType, durationMs?: number): Promise<void> {
  await enqueue({ event: "completion", adUnitType, durationMs });
}

export async function trackAdRewardEarned(
  adUnitType: AdUnitType,
  rewardAmount: number,
  rewardType?: string,
  revenueMicros?: number,
): Promise<void> {
  await enqueue({ event: "reward_earned", adUnitType, rewardAmount, rewardType, revenueMicros });
}

export async function trackAdLoadFailed(
  adUnitType: AdUnitType,
  errorCode?: string,
  errorMessage?: string,
): Promise<void> {
  await enqueue({ event: "load_failed", adUnitType, errorCode, errorMessage });
}

export async function trackAdClicked(adUnitType: AdUnitType): Promise<void> {
  await enqueue({ event: "clicked", adUnitType });
}
