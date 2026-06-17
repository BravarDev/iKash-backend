import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance, AxiosError } from 'axios';
import * as StellarSdk from '@stellar/stellar-sdk';

/**
 * TrustlessWorkService
 *
 * HTTP client wrapper for the Trustless Work REST API.
 * Handles all communication with the escrow protocol.
 *
 * SECURITY: This service NEVER handles private keys.
 * It builds unsigned transactions and broadcasts already-signed ones.
 */
@Injectable()
export class TrustlessWorkService {
  private readonly http: AxiosInstance;
  private readonly logger = new Logger(TrustlessWorkService.name);

  constructor(private readonly config: ConfigService) {
    const baseURL = this.config.getOrThrow<string>('TRUSTLESS_WORK_API_URL');
    const apiKey = this.config.getOrThrow<string>('TRUSTLESS_WORK_API_KEY');

    this.http = axios.create({
      baseURL,
      timeout: 60_000,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
    });
  }

  // ─── Deploy ────────────────────────────────────────────────────────────

  /**
   * Initialize a multi-release escrow contract.
   * Returns an unsigned XDR transaction that must be signed client-side.
   */
  async initializeEscrow(payload: {
    signer: string;
    engagementId: string;
    title: string;
    description: string;
    roles: Record<string, string>;
    platformFee: number;
    milestones: Array<{
      description: string;
      amount: number;
      receiver: string;
      status?: string;
    }>;
    trustline: { address: string; symbol: string };
  }): Promise<{ unsignedTransaction: string }> {
    return this.post('/deployer/multi-release', payload);
  }

  // ─── Fund ──────────────────────────────────────────────────────────────

  /**
   * Fund an existing escrow contract with USDC.
   * Returns an unsigned XDR transaction.
   */
  async fundEscrow(payload: {
    contractId: string;
    signer: string;
    amount: number;
  }): Promise<{ unsignedTransaction: string }> {
    return this.post('/escrow/multi-release/fund-escrow', payload);
  }

  // ─── Milestone ─────────────────────────────────────────────────────────

  /**
   * Change milestone status (service provider marks as complete).
   * Returns an unsigned XDR transaction.
   */
  async changeMilestoneStatus(payload: {
    contractId: string;
    milestoneIndex: string;
    newEvidence: string;
    newStatus: string;
    serviceProvider: string;
  }): Promise<{ unsignedTransaction: string }> {
    return this.post(
      '/escrow/multi-release/change-milestone-status',
      payload,
    );
  }

  /**
   * Approve a completed milestone (approver only).
   * Returns an unsigned XDR transaction.
   */
  async approveMilestone(payload: {
    contractId: string;
    approver: string;
    milestoneIndex: string;
  }): Promise<{ unsignedTransaction: string }> {
    return this.post(
      '/escrow/multi-release/approve-milestone',
      payload,
    );
  }

  /**
   * Release funds for a completed milestone.
   * Returns an unsigned XDR transaction.
   */
  async releaseMilestoneFunds(payload: {
    contractId: string;
    releaseSigner: string;
    milestoneIndex: string;
  }): Promise<{ unsignedTransaction: string }> {
    return this.post(
      '/escrow/multi-release/release-milestone-funds',
      payload,
    );
  }

  // ─── Broadcast ─────────────────────────────────────────────────────────

  /**
   * Send a signed XDR transaction to the Stellar network.
   * This is the ONLY method that actually executes on-chain.
   */
  async sendTransaction(
    signedXdr: string,
  ): Promise<{
    status: string;
    message?: string;
    contractId?: string;
    escrow?: any;
  }> {
    return this.post('/helper/send-transaction', { signedXdr });
  }

  /**
   * Sign an unsigned XDR with a backend-controlled secret key and broadcast it.
   *
   * Works at the raw byte level to avoid "Bad union switch" errors caused by
   * stellar-sdk not supporting the latest Soroban XDR types. We never parse
   * the inner transaction — only slice bytes, compute the hash, and inject
   * our signature.
   *
   * SECURITY: signerSecret must come from a backend env var, never from the client.
   */
  async signAndBroadcast(
    unsignedXdr: string,
    signerSecret: string,
    networkPassphrase: string,
  ): Promise<{
    status: string;
    contractId?: string;
    message?: string;
  }> {
    const keypair = StellarSdk.Keypair.fromSecret(signerSecret);

    const raw = Buffer.from(unsignedXdr, 'base64');

    // First 4 bytes = envelope type discriminant (big-endian uint32)
    const envelopeTypeValue = raw.readUInt32BE(0);

    // For unsigned envelopes the last 4 bytes are the empty signatures array (count = 0)
    const sigCount = raw.readUInt32BE(raw.length - 4);
    if (sigCount !== 0) {
      this.logger.warn(
        `Envelope already has ${sigCount} signature(s) — appending ours`,
      );
    }

    // Extract transaction body bytes (between envelope type prefix and signatures suffix)
    // For an unsigned tx: raw = [4-byte type] [tx bytes] [4-byte sig count = 0]
    const txBodyBytes = raw.subarray(4, raw.length - 4);

    // Compute hash preimage: SHA256(networkId || envelopeType || txBody)
    // The signing envelope type is always ENVELOPE_TYPE_TX (2) for v1 transactions
    // and ENVELOPE_TYPE_TX_FEE_BUMP (5) for fee bump — use what we read
    const networkId = StellarSdk.hash(Buffer.from(networkPassphrase));
    const typeTag = Buffer.alloc(4);
    typeTag.writeUInt32BE(envelopeTypeValue, 0);

    const hashPreimage = Buffer.concat([networkId, typeTag, txBodyBytes]);
    const txHash = StellarSdk.hash(hashPreimage);

    // Sign the hash with ed25519
    const signature = keypair.sign(txHash);
    const hint = keypair.signatureHint(); // last 4 bytes of public key

    // Build DecoratedSignature XDR:
    //   hint:      opaque[4]   → 4 bytes
    //   signature: opaque<64>  → 4 bytes length prefix + 64 bytes data
    const decoratedSig = Buffer.alloc(4 + 4 + 64);
    hint.copy(decoratedSig, 0);                  // hint (4 bytes)
    decoratedSig.writeUInt32BE(64, 4);            // signature length prefix
    signature.copy(decoratedSig, 8);              // signature data (64 bytes)

    // Reconstruct the signed envelope:
    //   [envelope type] [tx body] [new sig count] [existing sigs...] [our sig]
    const newSigCount = Buffer.alloc(4);
    newSigCount.writeUInt32BE(sigCount + 1, 0);

    // If there were existing signatures, we need to include them
    let existingSigs = Buffer.alloc(0);
    if (sigCount > 0) {
      // Each decorated signature is 4 (hint) + 4 (len) + 64 (sig) = 72 bytes
      const existingSigsLength = sigCount * 72;
      existingSigs = raw.subarray(raw.length - 4 - existingSigsLength, raw.length - 4);
      // Re-extract txBodyBytes without existing sigs
      const txEnd = raw.length - 4 - existingSigsLength;
      const signedEnvelope = Buffer.concat([
        raw.subarray(0, 4),                       // envelope type
        raw.subarray(4, txEnd),                    // tx body
        newSigCount,                               // updated sig count
        existingSigs,                              // existing signatures
        decoratedSig,                              // our new signature
      ]);
      const signedXdr = signedEnvelope.toString('base64');
      this.logger.debug(
        `Broadcasting backend-signed tx for signer ${keypair.publicKey().substring(0, 8)}…`,
      );
      return this.sendTransaction(signedXdr);
    }

    const signedEnvelope = Buffer.concat([
      raw.subarray(0, 4),                         // envelope type
      txBodyBytes,                                 // tx body (unchanged)
      newSigCount,                                 // sig count = 1
      decoratedSig,                                // our signature
    ]);

    const signedXdr = signedEnvelope.toString('base64');

    this.logger.debug(
      `Broadcasting backend-signed tx for signer ${keypair.publicKey().substring(0, 8)}…`,
    );

    return this.sendTransaction(signedXdr);
  }

  // ─── Query ─────────────────────────────────────────────────────────────

  /**
   * Get escrow data from the on-chain indexer by contract ID.
   * Optionally validates against the blockchain for integrity.
   */
  async getEscrowByContractId(
    contractId: string,
    validateOnChain = false,
  ): Promise<any> {
    const params = new URLSearchParams();
    params.append('contractIds[]', contractId);
    params.append('validateOnChain', String(validateOnChain));

    return this.get(`/helper/get-escrow-by-contract-ids?${params.toString()}`);
  }

  /**
   * Get the on-chain balance of an escrow contract.
   */
  async getEscrowBalance(contractAddress: string): Promise<any> {
    return this.get('/helper/get-multiple-escrow-balance', {
      params: { addresses: [contractAddress] },
    });
  }

  // ─── HTTP helpers ──────────────────────────────────────────────────────

  private async post<T>(url: string, data: unknown): Promise<T> {
    try {
      const res = await this.http.post<T>(url, data);
      return res.data;
    } catch (err) {
      this.handleError(err, `POST ${url}`);
    }
  }

  private async get<T>(url: string, config?: any): Promise<T> {
    try {
      const res = await this.http.get<T>(url, config);
      return res.data;
    } catch (err) {
      this.handleError(err, `GET ${url}`);
    }
  }

  private handleError(err: unknown, context: string): never {
    if (err instanceof AxiosError) {
      const status = err.response?.status ?? HttpStatus.BAD_GATEWAY;
      const message =
        err.response?.data?.message ??
        err.response?.data?.error ??
        err.message;

      this.logger.error(
        `Trustless Work API error [${context}]: ${status} — ${JSON.stringify(message)}`,
      );

      throw new HttpException(
        {
          error: 'TrustlessWorkError',
          message: `Escrow operation failed: ${message}`,
          details: err.response?.data,
        },
        status,
      );
    }

    this.logger.error(`Unexpected error [${context}]:`, err);
    throw new HttpException(
      'Unexpected error communicating with Trustless Work',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}
