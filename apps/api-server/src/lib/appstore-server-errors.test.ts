import { describe, it, expect } from "vitest";
import {
  APPSTORE_SERVER_ERROR_CODES,
  type AppStoreServerErrorCode,
} from "./appstore-server-errors";

describe("APPSTORE_SERVER_ERROR_CODES", () => {
  it("INVALID_TRANSACTION_TYPE_NOT_SUPPORTED equals 4000009", () => {
    expect(APPSTORE_SERVER_ERROR_CODES.INVALID_TRANSACTION_TYPE_NOT_SUPPORTED).toBe(4000009);
  });

  it("does not expose the deprecated code 4000043", () => {
    const values = Object.values(APPSTORE_SERVER_ERROR_CODES) as number[];
    expect(values).not.toContain(4000043);
  });
});

describe("AppStoreServerErrorCode type", () => {
  it("accepts 4000009 as a valid AppStoreServerErrorCode value at runtime", () => {
    const code: AppStoreServerErrorCode = 4000009;
    expect(code).toBe(4000009);
  });
});
