import { describe, it, expect } from "vitest";
import { getTranslations, type Language } from "../i18n";

const NON_ENGLISH_LOCALES: Language[] = ["es", "pt", "fr", "de"];

function collectLeafPaths(obj: unknown, prefix = ""): string[] {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
    return prefix ? [prefix] : [];
  }
  const record = obj as Record<string, unknown>;
  const entries = Object.entries(record);
  if (entries.length === 0) return prefix ? [prefix] : [];
  return entries.flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      return collectLeafPaths(value, path);
    }
    return [path];
  });
}

function getAtPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((cur, key) => {
    if (cur != null && typeof cur === "object" && !Array.isArray(cur)) {
      return (cur as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

describe("i18n translation completeness", () => {
  const en = getTranslations("en");
  const allPaths = collectLeafPaths(en);

  for (const locale of NON_ENGLISH_LOCALES) {
    it(`${locale} contains every key present in en`, () => {
      const trans = getTranslations(locale);
      const missing: string[] = [];

      for (const path of allPaths) {
        const val = getAtPath(trans, path);
        if (val === undefined) {
          missing.push(path);
        }
      }

      expect(
        missing,
        `Locale "${locale}" is missing ${missing.length} key(s):\n${missing.map((k) => `  - ${k}`).join("\n")}`
      ).toHaveLength(0);
    });
  }
});
