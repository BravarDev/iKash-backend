/**
 * Matches a positive decimal amount with up to 7 decimal places.
 * Stellar assets (e.g. USDC) use a precision of 7 decimals.
 * Examples: "1", "0.1234567"
 */
export const AMOUNT_REGEX = /^\d+(\.\d{1,7})?$/;

/**
 * Matches a valid user alias.
 * Allowed characters: lowercase letters (a-z), digits (0-9), dot (.), exclamation mark (!), underscore (_).
 * No spaces, no uppercase letters, no other special characters.
 * Examples: "john_doe1", "jane.doe", "user!1"
 */
export const ALIAS_REGEX = /^[a-z0-9.!_]+$/;
