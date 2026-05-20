/**
 * Core logic for check-signing-md-sync, extracted for unit testing.
 *
 * All file I/O and process.exit() live in check-signing-md-sync.ts (the CLI
 * entry point). This module is pure: it accepts file contents as strings and
 * returns a structured result so tests can exercise every branch without
 * spawning a subprocess or touching the filesystem.
 */

export const BUMP_CMD = "pnpm --filter @workspace/scripts run bump-build-number";
export const BUMP_VERSION_CMD =
  "pnpm --filter @workspace/scripts run bump-version -- <patch|minor|major>";

export type CheckResult = {
  /** true when at least one mismatch or missing field was detected */
  hasIssue: boolean;
  /** one entry per failed check */
  errors: string[];
  /** one entry per passed check */
  infos: string[];
};

type AppJsonParsed = {
  version: string;
  iosBuildNumber: number;
  androidVersionCode: number;
};

/**
 * Parse and validate the raw content of app.json.
 *
 * Throws a descriptive Error when the JSON is malformed or any required field
 * is missing / invalid — matching the behaviour of the CLI entry point.
 */
export function parseAppJson(content: string): AppJsonParsed {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch (err) {
    throw new Error(
      "Could not read or parse artifacts/cashclip/app.json.\n" + String(err)
    );
  }

  const expo = (raw as { expo?: unknown }).expo as {
    version?: unknown;
    ios?: { buildNumber?: unknown };
    android?: { versionCode?: unknown };
  } | undefined;

  const version = expo?.version;
  if (typeof version !== "string" || version === "") {
    throw new Error("expo.version is missing or empty in app.json.");
  }

  const rawBuildNumber = expo?.ios?.buildNumber;
  const iosBuildNumber = parseInt(String(rawBuildNumber ?? "0"), 10);
  if (rawBuildNumber !== undefined && isNaN(iosBuildNumber)) {
    throw new Error(
      `ios.buildNumber "${rawBuildNumber}" in app.json is not a valid integer.`
    );
  }

  const androidVersionCode =
    typeof expo?.android?.versionCode === "number"
      ? expo.android.versionCode
      : 0;

  return { version, iosBuildNumber, androidVersionCode };
}

/**
 * Compare the values parsed from app.json against SIGNING.md and return a
 * structured result.  No I/O, no process.exit.
 */
export function checkSigningMdSync(
  appJson: AppJsonParsed,
  signingMdContent: string
): CheckResult {
  const errors: string[] = [];
  const infos: string[] = [];

  const headerMatch = signingMdContent.match(
    /^Saved state as of build number \*\*(\d+)\*\*/m
  );
  const appVersionMatch = signingMdContent.match(
    /^\|\s*App version\s*\|\s*`([^`]+)`\s*\|/m
  );
  const iosMatch = signingMdContent.match(
    /^\|\s*iOS build number\s*\|\s*`(\d+)`\s*\|/m
  );
  const androidMatch = signingMdContent.match(
    /^\|\s*Android version code\s*\|\s*`(\d+)`\s*\|/m
  );

  // --- Check 1: snapshot header vs iOS table row ---

  if (!headerMatch) {
    errors.push(
      "\u274C  SIGNING.md snapshot header not found.\n" +
      '   Expected a line matching: Saved state as of build number **<number>**\n' +
      `   Run the bump script to regenerate it:\n\n     ${BUMP_CMD}\n`
    );
  }

  if (!iosMatch) {
    errors.push(
      "\u274C  Could not find an \"iOS build number\" row in SIGNING.md.\n" +
      "   Expected a line matching: | iOS build number | `<number>` |\n" +
      `   Run the bump script to regenerate it:\n\n     ${BUMP_CMD}\n`
    );
  }

  if (headerMatch && iosMatch) {
    const headerBuild = parseInt(headerMatch[1], 10);
    const rowBuild = parseInt(iosMatch[1], 10);
    if (headerBuild !== rowBuild) {
      errors.push(
        "\u274C  SIGNING.md header and iOS build number row disagree.\n" +
        `   Snapshot header says:      build number ${headerBuild}\n` +
        `   iOS build number row says: ${rowBuild}\n\n` +
        "   These must always match. Run the bump script to resync:\n\n" +
        `     ${BUMP_CMD}\n`
      );
    } else {
      infos.push(
        `\u2705  SIGNING.md header and iOS build number row agree: build number ${headerBuild}`
      );
    }
  }

  // --- Check 2: SIGNING.md table rows vs app.json ---

  if (!appVersionMatch) {
    errors.push(
      "\u274C  Could not find an \"App version\" row in SIGNING.md.\n" +
      "   Expected a line matching: | App version | `<version>` |\n" +
      "   The table format may have changed — update SIGNING.md manually or re-run the bump script:\n\n" +
      `     ${BUMP_VERSION_CMD}\n`
    );
  } else if (appJson.version !== appVersionMatch[1]) {
    errors.push(
      "\u274C  SIGNING.md OUT OF SYNC: App version\n" +
      `   app.json expo.version       = ${appJson.version}\n` +
      `   SIGNING.md App version row  = ${appVersionMatch[1]}\n\n` +
      "   These must match. If you edited expo.version in app.json directly,\n" +
      "   re-run bump-build-number to keep both files in sync:\n\n" +
      `     ${BUMP_CMD}\n\n` +
      "   If you intentionally changed the version, use the bump-version script instead\n" +
      "   so that SIGNING.md is updated automatically:\n\n" +
      `     ${BUMP_VERSION_CMD}\n`
    );
  }

  if (iosMatch) {
    const signingIosBuild = parseInt(iosMatch[1], 10);
    if (appJson.iosBuildNumber !== signingIosBuild) {
      errors.push(
        "\u274C  SIGNING.md OUT OF SYNC: iOS build number\n" +
        `   app.json ios.buildNumber        = ${appJson.iosBuildNumber}\n` +
        `   SIGNING.md iOS build number row = ${signingIosBuild}\n\n` +
        "   Run the bump script to keep both files in sync:\n\n" +
        `     ${BUMP_CMD}\n`
      );
    }
  }

  if (!androidMatch) {
    errors.push(
      "\u274C  Could not find an \"Android version code\" row in SIGNING.md.\n" +
      "   Expected a line matching: | Android version code | `<number>` |\n" +
      `   Run the bump script to regenerate it:\n\n     ${BUMP_CMD}\n`
    );
  } else {
    const signingAndroidCode = parseInt(androidMatch[1], 10);
    if (appJson.androidVersionCode !== signingAndroidCode) {
      errors.push(
        "\u274C  SIGNING.md OUT OF SYNC: Android version code\n" +
        `   app.json android.versionCode        = ${appJson.androidVersionCode}\n` +
        `   SIGNING.md Android version code row = ${signingAndroidCode}\n\n` +
        "   Run the bump script to keep both files in sync:\n\n" +
        `     ${BUMP_CMD}\n`
      );
    }
  }

  return { hasIssue: errors.length > 0, errors, infos };
}
