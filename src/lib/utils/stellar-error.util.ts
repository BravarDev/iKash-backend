/**
 * Normalizes Horizon/Stellar submission errors into clear, user-facing messages.
 *
 * Horizon returns result codes under `response.data.extras.result_codes`, split
 * into a transaction-level code and a list of operation-level codes. This helper
 * maps the most common scenarios to readable messages and falls back to generic
 * messages when the codes are missing or unknown.
 */

interface HorizonResultCodes {
  transaction?: string;
  operations?: string[];
}

const DEFAULT_ERROR_MESSAGE = 'The transaction could not be submitted to Stellar.';

const OPERATION_ERROR_MESSAGES: Record<string, string> = {
  op_no_trust: 'The recipient or the fee collector has no USDC trustline.',
  op_underfunded: 'Insufficient funds to cover the amount and the fee.',
};

const TRANSACTION_ERROR_MESSAGES: Record<string, string> = {
  tx_insufficient_balance: 'Insufficient funds to cover the amount and the fee.',
  tx_bad_auth: 'The transaction is not signed correctly.',
  tx_bad_auth_extra: 'The transaction is not signed correctly.',
  tx_too_late: 'The transaction expired. Please prepare and sign it again.',
  tx_too_early: 'The transaction expired. Please prepare and sign it again.',
};

function extractResultCodes(err: unknown): HorizonResultCodes {
  const codes = (err as any)?.response?.data?.extras?.result_codes;
  return {
    transaction: codes?.transaction,
    operations: codes?.operations ?? [],
  };
}

/**
 * Returns a human-readable message describing why a Stellar transaction failed.
 */
export function describeHorizonError(err: unknown): string {
  const { transaction: txCode, operations: opCodes = [] } =
    extractResultCodes(err);

  for (const opCode of opCodes) {
    const message = OPERATION_ERROR_MESSAGES[opCode];
    if (message) {
      return message;
    }
  }

  if (txCode) {
    return (
      TRANSACTION_ERROR_MESSAGES[txCode] ??
      `Stellar rejected the transaction (${txCode}).`
    );
  }

  return DEFAULT_ERROR_MESSAGE;
}
