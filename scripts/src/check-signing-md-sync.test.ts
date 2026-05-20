/**
 * Unit tests for check-signing-md-sync-lib.ts
 *
 * Run with:  pnpm --filter @workspace/scripts run test
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseAppJson, checkSigningMdSync } from "./check-signing-md-sync-lib.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAppJson(
  version = "1.2.3",
  buildNumber = "22",
  versionCode = 5
): string {
  return JSON.stringify({
    expo: {
      version,
      ios: { buildNumber },
      android: { versionCode },
    },
  });
}

/**
 * Minimal valid SIGNING.md content where all three values match the defaults
 * used in makeAppJson().
 */
function makeSigningMd(
  headerBuild = 22,
  tableIosBuild = 22,
  appVersion = "1.2.3",
  androidCode = 5
): string {
  return [
    `Saved state as of build number **${headerBuild}** — ready for submission`,
    "",
    "| Field                | Value           |",
    "| -------------------- | --------------- |",
    `| App version          | \`${appVersion}\` |`,
    `| iOS build number     | \`${tableIosBuild}\` |`,
    `| Android version code | \`${androidCode}\` |`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// parseAppJson
// ---------------------------------------------------------------------------

describe("parseAppJson", () => {
  test("parses a valid app.json correctly", () => {
    const result = parseAppJson(makeAppJson("1.0.0", "10", 3));
    assert.equal(result.version, "1.0.0");
    assert.equal(result.iosBuildNumber, 10);
    assert.equal(result.androidVersionCode, 3);
  });

  test("throws on malformed JSON", () => {
    assert.throws(() => parseAppJson("not json"), /Could not read or parse/);
  });

  test("throws when expo.version is missing", () => {
    const content = JSON.stringify({ expo: { ios: { buildNumber: "1" }, android: { versionCode: 1 } } });
    assert.throws(() => parseAppJson(content), /expo\.version is missing/);
  });

  test("throws when expo.version is empty string", () => {
    const content = JSON.stringify({ expo: { version: "", ios: { buildNumber: "1" }, android: { versionCode: 1 } } });
    assert.throws(() => parseAppJson(content), /expo\.version is missing/);
  });

  test("throws when ios.buildNumber is not a valid integer", () => {
    const content = JSON.stringify({ expo: { version: "1.0.0", ios: { buildNumber: "abc" }, android: { versionCode: 1 } } });
    assert.throws(() => parseAppJson(content), /not a valid integer/);
  });

  test("defaults iosBuildNumber to 0 when ios section is absent", () => {
    const content = JSON.stringify({ expo: { version: "1.0.0", android: { versionCode: 2 } } });
    const result = parseAppJson(content);
    assert.equal(result.iosBuildNumber, 0);
  });

  test("defaults androidVersionCode to 0 when android section is absent", () => {
    const content = JSON.stringify({ expo: { version: "1.0.0", ios: { buildNumber: "5" } } });
    const result = parseAppJson(content);
    assert.equal(result.androidVersionCode, 0);
  });
});

// ---------------------------------------------------------------------------
// checkSigningMdSync — happy path
// ---------------------------------------------------------------------------

describe("checkSigningMdSync — happy path", () => {
  test("returns hasIssue=false when all fields are in sync", () => {
    const appJson = parseAppJson(makeAppJson("1.2.3", "22", 5));
    const md = makeSigningMd(22, 22, "1.2.3", 5);
    const result = checkSigningMdSync(appJson, md);
    assert.equal(result.hasIssue, false);
    assert.deepEqual(result.errors, []);
  });

  test("produces an info message confirming header and iOS row agree", () => {
    const appJson = parseAppJson(makeAppJson("1.2.3", "22", 5));
    const md = makeSigningMd(22, 22, "1.2.3", 5);
    const result = checkSigningMdSync(appJson, md);
    assert.ok(
      result.infos.some((m) => m.includes("build number 22")),
      "expected info about build number 22"
    );
  });
});

// ---------------------------------------------------------------------------
// checkSigningMdSync — app version mismatch
// ---------------------------------------------------------------------------

describe("checkSigningMdSync — app version mismatch", () => {
  test("detects app version mismatch", () => {
    const appJson = parseAppJson(makeAppJson("2.0.0", "22", 5));
    const md = makeSigningMd(22, 22, "1.2.3", 5);
    const result = checkSigningMdSync(appJson, md);
    assert.equal(result.hasIssue, true);
    assert.ok(
      result.errors.some((e) => e.includes("App version")),
      "expected an error mentioning 'App version'"
    );
  });

  test("error message includes both the app.json value and the SIGNING.md value", () => {
    const appJson = parseAppJson(makeAppJson("2.0.0", "22", 5));
    const md = makeSigningMd(22, 22, "1.2.3", 5);
    const result = checkSigningMdSync(appJson, md);
    const err = result.errors.find((e) => e.includes("App version")) ?? "";
    assert.ok(err.includes("2.0.0"), "expected app.json version in error");
    assert.ok(err.includes("1.2.3"), "expected SIGNING.md version in error");
  });
});

// ---------------------------------------------------------------------------
// checkSigningMdSync — iOS build number mismatch
// ---------------------------------------------------------------------------

describe("checkSigningMdSync — iOS build number mismatch", () => {
  test("detects iOS build number mismatch between app.json and SIGNING.md table row", () => {
    const appJson = parseAppJson(makeAppJson("1.2.3", "30", 5));
    const md = makeSigningMd(22, 22, "1.2.3", 5);
    const result = checkSigningMdSync(appJson, md);
    assert.equal(result.hasIssue, true);
    assert.ok(
      result.errors.some((e) => e.includes("iOS build number")),
      "expected an error mentioning 'iOS build number'"
    );
  });

  test("error message includes both the app.json value and the SIGNING.md value", () => {
    const appJson = parseAppJson(makeAppJson("1.2.3", "30", 5));
    const md = makeSigningMd(22, 22, "1.2.3", 5);
    const result = checkSigningMdSync(appJson, md);
    const err = result.errors.find((e) => e.includes("iOS build number")) ?? "";
    assert.ok(err.includes("30"), "expected app.json build number in error");
    assert.ok(err.includes("22"), "expected SIGNING.md build number in error");
  });
});

// ---------------------------------------------------------------------------
// checkSigningMdSync — Android version code mismatch
// ---------------------------------------------------------------------------

describe("checkSigningMdSync — Android version code mismatch", () => {
  test("detects Android version code mismatch", () => {
    const appJson = parseAppJson(makeAppJson("1.2.3", "22", 99));
    const md = makeSigningMd(22, 22, "1.2.3", 5);
    const result = checkSigningMdSync(appJson, md);
    assert.equal(result.hasIssue, true);
    assert.ok(
      result.errors.some((e) => e.includes("Android version code")),
      "expected an error mentioning 'Android version code'"
    );
  });

  test("error message includes both the app.json value and the SIGNING.md value", () => {
    const appJson = parseAppJson(makeAppJson("1.2.3", "22", 99));
    const md = makeSigningMd(22, 22, "1.2.3", 5);
    const result = checkSigningMdSync(appJson, md);
    const err = result.errors.find((e) => e.includes("Android version code")) ?? "";
    assert.ok(err.includes("99"), "expected app.json versionCode in error");
    assert.ok(err.includes("5"), "expected SIGNING.md versionCode in error");
  });
});

// ---------------------------------------------------------------------------
// checkSigningMdSync — SIGNING.md header vs iOS table row disagreement
// ---------------------------------------------------------------------------

describe("checkSigningMdSync — header / iOS row disagree", () => {
  test("detects when snapshot header build number differs from iOS table row", () => {
    const appJson = parseAppJson(makeAppJson("1.2.3", "22", 5));
    const md = makeSigningMd(21, 22, "1.2.3", 5);
    const result = checkSigningMdSync(appJson, md);
    assert.equal(result.hasIssue, true);
    assert.ok(
      result.errors.some((e) => e.includes("header and iOS build number row disagree")),
      "expected disagreement error"
    );
  });
});

// ---------------------------------------------------------------------------
// checkSigningMdSync — missing / malformed SIGNING.md rows
// ---------------------------------------------------------------------------

describe("checkSigningMdSync — missing SIGNING.md rows", () => {
  test("detects missing snapshot header", () => {
    const appJson = parseAppJson(makeAppJson());
    const md = makeSigningMd().replace(/^Saved state.*$/m, "");
    const result = checkSigningMdSync(appJson, md);
    assert.equal(result.hasIssue, true);
    assert.ok(
      result.errors.some((e) => e.includes("snapshot header not found")),
      "expected missing-header error"
    );
  });

  test("detects missing App version row", () => {
    const appJson = parseAppJson(makeAppJson());
    const md = makeSigningMd().replace(/^\| App version.*$/m, "");
    const result = checkSigningMdSync(appJson, md);
    assert.equal(result.hasIssue, true);
    assert.ok(
      result.errors.some((e) => e.includes("App version") && e.includes("Could not find")),
      "expected missing-app-version error"
    );
  });

  test("detects missing iOS build number row", () => {
    const appJson = parseAppJson(makeAppJson());
    const md = makeSigningMd().replace(/^\| iOS build number.*$/m, "");
    const result = checkSigningMdSync(appJson, md);
    assert.equal(result.hasIssue, true);
    assert.ok(
      result.errors.some((e) => e.includes("iOS build number") && e.includes("Could not find")),
      "expected missing-ios-row error"
    );
  });

  test("detects missing Android version code row", () => {
    const appJson = parseAppJson(makeAppJson());
    const md = makeSigningMd().replace(/^\| Android version code.*$/m, "");
    const result = checkSigningMdSync(appJson, md);
    assert.equal(result.hasIssue, true);
    assert.ok(
      result.errors.some((e) => e.includes("Android version code") && e.includes("Could not find")),
      "expected missing-android-row error"
    );
  });

  test("detects completely empty SIGNING.md", () => {
    const appJson = parseAppJson(makeAppJson());
    const result = checkSigningMdSync(appJson, "");
    assert.equal(result.hasIssue, true);
    assert.ok(result.errors.length >= 3, "expected at least 3 errors for empty SIGNING.md");
  });
});

// ---------------------------------------------------------------------------
// checkSigningMdSync — multiple mismatches reported together
// ---------------------------------------------------------------------------

describe("checkSigningMdSync — multiple mismatches", () => {
  test("reports all three field mismatches independently", () => {
    const appJson = parseAppJson(makeAppJson("9.9.9", "99", 99));
    const md = makeSigningMd(1, 1, "1.0.0", 1);
    const result = checkSigningMdSync(appJson, md);
    assert.equal(result.hasIssue, true);
    const combined = result.errors.join("\n");
    assert.ok(combined.includes("App version"), "expected App version error");
    assert.ok(combined.includes("iOS build number"), "expected iOS build number error");
    assert.ok(combined.includes("Android version code"), "expected Android version code error");
  });
});
