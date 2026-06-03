import { describe, it, expect, beforeAll } from "vitest";

let verifyProviderCompletion: typeof import("./surveyProviders").verifyProviderCompletion;

beforeAll(async () => {
  const mod = await import("./surveyProviders");
  verifyProviderCompletion = mod.verifyProviderCompletion;
});
