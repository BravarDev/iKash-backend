/**
 * Matches a positive decimal amount with up to 7 decimal places.
 * Stellar assets (e.g. USDC) use a precision of 7 decimals.
 * Examples: "1", "0.1234567"
 */
export const AMOUNT_REGEX = /^\d+(\.\d{1,7})?$/;
