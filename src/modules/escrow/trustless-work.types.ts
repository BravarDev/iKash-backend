/**
 * trustless-work.types.ts
 *
 * Canonical types extracted from the Trustless Work API documentation.
 * Source: https://docs.trustlesswork.com/trustless-work/introduction/developer-resources/types
 *
 * These replace the ad-hoc inline objects in the original TrustlessWorkService
 * and are the single source of truth for all payloads sent to the TW REST API.
 *
 * NOTE: The `@trustless-work/escrow` npm package only exports React hooks;
 * it cannot be used in a NestJS/Node.js backend. These types mirror the
 * official SDK types so you get the same type-safety without the browser dependency.
 */

// ─── Primitives ────────────────────────────────────────────────────────────────

export type EscrowType = 'single-release' | 'multi-release';
export type SingleReleaseEscrowStatus = 'pending' | 'active' | 'completed' | 'disputed' | 'resolved';
export type Status = 'SUCCESS' | 'ERROR' | 'PENDING';

// ─── Shared sub-types ──────────────────────────────────────────────────────────

/**
 * Roles object for a multi-release escrow.
 * `receiver` lives at the milestone level in multi-release, so it is omitted here.
 *
 * Field names must match the API exactly — any unknown key causes a 400 "Validation failed".
 */
export type MultiReleaseRoles = {
  /** Verifies and approves each milestone before funds are released. */
  approver: string;
  /** Performs the work and changes milestone status to 'completed'. */
  serviceProvider: string;
  /** Collects the platform fee upon release. Also acts as the deployer signer. */
  platformAddress: string;
  /** Signs the release-funds transaction (can be the same as serviceProvider or a third party). */
  releaseSigner: string;
  /** Resolves disputes when raised. */
  disputeResolver: string;
};

/**
 * Trustline configuration.
 * For XLM / native asset use `{ address: '', symbol: 'XLM' }` — NOT null.
 * Sending null causes a 400 validation error on the deployer endpoint.
 */
export type Trustline = {
  /** Issuer account address (G…). Empty string for native XLM. */
  address: string;
  /** Asset code, e.g. 'USDC', 'EURC', 'XLM'. */
  symbol: string;
};

export type Flags = {
  disputed?: boolean;
  released?: boolean;
  resolved?: boolean;
  approved?: boolean;
};

// ─── Milestone types ───────────────────────────────────────────────────────────

/** Payload for each milestone when initializing a multi-release escrow. */
export type MultiReleaseMilestonePayload = {
  /** Human-readable description of this milestone. */
  description: string;
  /** Amount in the token's base unit (e.g. USDC with 7 decimals on Stellar). */
  amount: number;
  /** Address that receives the funds when this milestone is released. */
  receiver: string;
  /** Optional initial status. Omit to let the contract default to empty. */
  status?: string;
};

/** Full on-chain milestone shape (returned by indexer queries). */
export type MultiReleaseMilestone = MultiReleaseMilestonePayload & {
  evidence?: string;
  flags?: Flags;
};

// ─── Initialize Escrow ─────────────────────────────────────────────────────────

/**
 * Payload for POST /deployer/multi-release
 *
 * Required fields enforced by the API:
 *   signer, engagementId, title, description, roles, platformFee, milestones, trustline
 *
 * IMPORTANT: `roles` must not contain a `client` key — that field does not exist
 * in the TW API schema and will trigger "Validation failed".
 */
export type InitializeMultiReleaseEscrowPayload = {
  /** Stellar address that signs the deploy transaction (typically your treasury). */
  signer: string;
  /** Stable identifier your platform uses to correlate this escrow (e.g. orderId). */
  engagementId: string;
  /** Short human-readable title. */
  title: string;
  /** Longer description of what this escrow covers. */
  description: string;
  /** Role assignments — must be a plain object, NOT an array. */
  roles: MultiReleaseRoles;
  /** Platform fee percentage (1 = 1%). Cannot exceed 99. */
  platformFee: number;
  /** At least one milestone required; max 50. */
  milestones: MultiReleaseMilestonePayload[];
  /**
   * Trustline for the token used in this escrow.
   * Use `{ address: '', symbol: 'XLM' }` for native XLM — never null/undefined.
   */
  trustline: Trustline;
};

// ─── Fund Escrow ───────────────────────────────────────────────────────────────

/** Payload for POST /escrow/multi-release/fund-escrow */
export type FundEscrowPayload = {
  /** Deployed contract address returned after initialize. */
  contractId: string;
  /** Address of the user signing (and funding) the transaction. */
  signer: string;
  /** Amount to deposit — must match the sum of milestone amounts. */
  amount: number;
};

// ─── Change Milestone Status ───────────────────────────────────────────────────

/** Payload for POST /escrow/multi-release/change-milestone-status */
export type ChangeMilestoneStatusPayload = {
  contractId: string;
  /** Zero-based index as a string, e.g. '0'. */
  milestoneIndex: string;
  /** New status value, e.g. 'completed'. */
  newStatus: string;
  /** Evidence reference (URL, hash, free text). Required by the API schema. */
  newEvidence: string;
  /** Must match the serviceProvider role set at initialize time. */
  serviceProvider: string;
};

// ─── Approve Milestone ─────────────────────────────────────────────────────────

/** Payload for POST /escrow/multi-release/approve-milestone */
export type ApproveMilestonePayload = {
  contractId: string;
  milestoneIndex: string;
  /** Must match the approver role set at initialize time. */
  approver: string;
};

// ─── Release Milestone Funds ───────────────────────────────────────────────────

/** Payload for POST /escrow/multi-release/release-milestone-funds */
export type ReleaseMilestoneFundsPayload = {
  contractId: string;
  /** Must match the releaseSigner role set at initialize time. */
  releaseSigner: string;
  milestoneIndex: string;
};

// ─── Send Transaction ──────────────────────────────────────────────────────────

/** Payload for POST /helper/send-transaction */
export type SendTransactionPayload = {
  /** Base64-encoded signed XDR. */
  signedXdr: string;
};

// ─── Responses ─────────────────────────────────────────────────────────────────

/**
 * Generic response for operations that return an unsigned XDR.
 * The caller signs this XDR and submits it via sendTransaction.
 */
export type UnsignedTransactionResponse = {
  unsignedTransaction: string;
};

/**
 * Response from POST /helper/send-transaction after a successful deploy.
 * `contractId` is only present when the transaction was a factory deploy.
 */
export type SendTransactionResponse = {
  status: string;
  message?: string;
  /** Present only on successful escrow deployments. */
  contractId?: string;
  escrow?: unknown;
};

/** Shape returned by the indexer for a multi-release escrow. */
export type EscrowIndexerEntry = {
  signer?: string;
  contractId?: string;
  engagementId: string;
  title: string;
  roles: MultiReleaseRoles;
  description: string;
  platformFee: number;
  balance?: number;
  milestones: MultiReleaseMilestone[];
  flags?: Flags;
  trustline: Trustline & { name: string };
  isActive?: boolean;
  createdAt: string;
  updatedAt: string;
  type: EscrowType;
};

/** Response from GET /helper/get-multiple-escrow-balance */
export type EscrowBalanceResponse = {
  address: string;
  balance: number;
};
