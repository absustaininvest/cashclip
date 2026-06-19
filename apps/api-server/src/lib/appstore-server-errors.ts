// Apple App Store Server API — Error Type Constants
//
// Reference: https://developer.apple.com/documentation/appstoreserverapi/error_codes
// Changelog: https://developer.apple.com/documentation/appstoreserverapi/app_store_server_api_changelog
//
// Apple deprecated InvalidTransactionNotConsumableError (4000043) in
// App Store Server API 1.9–1.11. Use INVALID_TRANSACTION_TYPE_NOT_SUPPORTED
// (4000009) as the canonical replacement for unsupported transaction types.

export const APPSTORE_SERVER_ERROR_CODES = {
  // ── General ────────────────────────────────────────────────────────────────
  GENERAL_INTERNAL: 4000000,
  INVALID_APP_IDENTIFIER: 4000002,
  INVALID_REQUEST_REVISION: 4000003,
  INVALID_TRANSACTION_ID: 4000006,
  INVALID_ORIGINAL_TRANSACTION_ID: 4000008,

  // The canonical replacement for the deprecated INVALID_TRANSACTION_NOT_CONSUMABLE
  // (4000043). Use this constant for all unsupported-transaction-type errors.
  // Introduced in App Store Server API 1.9.
  INVALID_TRANSACTION_TYPE_NOT_SUPPORTED: 4000009,

  INVALID_PAGINATION_TOKEN: 4000010,
  PAGINATION_TOKEN_EXPIRED: 4000011,
  INVALID_INCLUDE_CONSUMPTION_EVENTS: 4000030,
  INVALID_CUSTOMER_CONSENT: 4000032,
  INVALID_DELIVERY_STATUS: 4000033,
  INVALID_APP_ACCOUNT_TOKEN: 4000034,
  INVALID_ACCOUNT_TENURE: 4000035,
  INVALID_PLAY_TIME: 4000036,
  INVALID_LIFETIME_DOLLARS_PURCHASED: 4000037,
  INVALID_LIFETIME_DOLLARS_REFUNDED: 4000038,
  INVALID_PLATFORM: 4000039,
  INVALID_SAMPLE_CONTENT_PROVIDED: 4000040,
  INVALID_USER_STATUS: 4000041,

  // ── DEPRECATED — do NOT use ────────────────────────────────────────────────
  // Apple deprecated code 4000043 in App Store Server API 1.9.
  // Use INVALID_TRANSACTION_TYPE_NOT_SUPPORTED (4000009) instead.
  //
  // INVALID_TRANSACTION_NOT_CONSUMABLE: 4000043,  // @deprecated

  // ── Rate limiting / availability ───────────────────────────────────────────
  RATE_LIMIT_EXCEEDED: 4290000,

  // ── Not found ──────────────────────────────────────────────────────────────
  TRANSACTION_ID_NOT_FOUND: 4040010,
  ORIGINAL_TRANSACTION_ID_NOT_FOUND: 4040005,
} as const;

export type AppStoreServerErrorCode =
  (typeof APPSTORE_SERVER_ERROR_CODES)[keyof typeof APPSTORE_SERVER_ERROR_CODES];
