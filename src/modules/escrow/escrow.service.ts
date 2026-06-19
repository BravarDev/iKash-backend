/**
 * escrow.service.ts
 *
 * Business logic for the iKash P2P escrow flow.
 *
 * Key fixes from the original:
 *
 *  1. ROLES — The `roles` object no longer includes a `client` key.
 *     The Trustless Work API schema for /deployer/multi-release only accepts:
 *       approver, serviceProvider, platformAddress, releaseSigner, disputeResolver
 *     Sending any extra key (like `client`) causes 400 "Validation failed".
 *
 *  2. TRUSTLINE — For non-USDC assets (XLM/native), the trustline is now
 *     `{ address: '', symbol: 'XLM' }` instead of `null`.
 *     The API requires a non-null trustline object on every deploy call.
 *
 *  3. TYPES — All TW payloads are built via the typed helpers in
 *     trustless-work.types.ts, so TypeScript will catch schema drift at
 *     compile time before it reaches the network.
 */

import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaginationDto } from '../../common/pagination.dto';
import { CreateEscrowDto } from './dto/create-escrow.dto';
import { UpdateEscrowDto } from './dto/update-escrow.dto';
import { OpenEscrowDto } from './dto/open-escrow.dto';
import { InitializeEscrowDto } from './dto/initialize-escrow.dto';
import { FundEscrowDto } from './dto/fund-escrow.dto';
import { FiatSentDto } from './dto/fiat-sent.dto';
import { ReleaseEscrowDto } from './dto/release-escrow.dto';
import { SyncEscrowDto, EscrowAction } from './dto/sync-escrow.dto';
import { EscrowRepository } from './escrow.repository';
import { TrustlessWorkService } from './trustless-work.service';
import {
  InitializeMultiReleaseEscrowPayload,
  MultiReleaseRoles,
  Trustline,
} from './trustless-work.types';

@Injectable()
export class EscrowService {
  private readonly logger = new Logger(EscrowService.name);

  constructor(
    private readonly repo: EscrowRepository,
    private readonly tw: TrustlessWorkService,
    private readonly config: ConfigService,
  ) {}

  // ─── Helpers ───────────────────────────────────────────────────────────────

  /**
   * Validates that the asset code is USDC (case-insensitive).
   * Defaults to USDC if undefined. Throws 400 for any other asset.
   */
  private validateAssetCode(assetCode: string | undefined): void {
    const normalized = (assetCode || 'USDC').toUpperCase();
    if (normalized !== 'USDC') {
      throw new BadRequestException(
        `Unsupported asset: "${assetCode}". Only USDC is accepted for escrow operations.`,
      );
    }
  }

  /**
   * Returns the Stellar network passphrase based on the STELLAR_NETWORK env var.
   */
  private getNetworkPassphrase(): string {
    const network = this.config
      .get<string>('STELLAR_NETWORK', 'testnet')
      .toLowerCase();
    return network === 'public'
      ? 'Public Global Stellar Network ; September 2015'
      : 'Test SDF Network ; September 2015';
  }

  /**
   * Resolves the trustline object for a given asset code.
   *
   * IMPORTANT: The TW API requires a non-null trustline with a valid Stellar
   * address on every deploy. For XLM/native, the address is the Soroban
   * Stellar Asset Contract (SAC) for the native token — NOT an empty string.
   *
   * SAC addresses (deterministic, per network):
   *   Testnet : CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC
   *   Mainnet : CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC
   *             (same hash — native SAC address is identical on both networks)
   *
   * For USDC or other issued assets, the address is the issuer's G... account.
   */
  private resolveTrustline(assetCode: string | undefined): Trustline {
    const isNative =
      !assetCode ||
      assetCode === 'XLM' ||
      assetCode === 'native' ||
      assetCode === '';

    if (isNative) {
      // Native XLM Soroban SAC contract address (valid on testnet and mainnet)
      const xlmSacAddress =
        this.config.get<string>('TRUSTLESS_WORK_XLM_ADDRESS') ??
        'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';
      return { address: xlmSacAddress, symbol: 'XLM' };
    }

    const usdcIssuer = this.config.getOrThrow<string>(
      'TRUSTLESS_WORK_USDC_ISSUER',
    );
    return { address: usdcIssuer, symbol: assetCode };
  }

  /**
   * Builds the `roles` object accepted by the TW multi-release deployer.
   *
   * Valid keys (from TW API schema MultiReleaseContract.roles):
   *   approver, serviceProvider, platformAddress, releaseSigner, disputeResolver
   *
   * The P2P mapping is:
   *   - approver       → treasury (platform auto-approves after seller confirms fiat)
   *   - serviceProvider → buyer   (provides the fiat "service")
   *   - platformAddress → treasury
   *   - releaseSigner  → seller   (retains power to release once fiat is received)
   *   - disputeResolver → support
   */
  private buildP2PRoles(
    sellerAddress: string,
    buyerAddress: string,
  ): MultiReleaseRoles {
    const treasury = this.config.getOrThrow<string>('IKASH_TREASURY_ADDRESS');
    const support = this.config.getOrThrow<string>('IKASH_SUPPORT_ADDRESS');

    return {
      approver: treasury,
      serviceProvider: buyerAddress,  // buyer provides fiat
      platformAddress: treasury,
      releaseSigner: sellerAddress,   // seller releases once fiat arrives
      disputeResolver: support,
    };
  }

  private async getOrFail(id: string) {
    const escrow = await this.repo.findById(id);
    if (!escrow) throw new NotFoundException(`Escrow ${id} not found`);
    return escrow;
  }

  private validateStatusTransition(
    currentStatus: string,
    action: EscrowAction,
  ) {
    const validTransitions: Record<string, string[]> = {
      [EscrowAction.INITIALIZE]: ['pending'],
      [EscrowAction.FUND]: ['initialized'],
      [EscrowAction.FIAT_SENT]: ['funded'],
      [EscrowAction.RELEASE]: ['funded', 'fiat_sent'],
    };

    const allowed = validTransitions[action];
    if (!allowed || !allowed.includes(currentStatus)) {
      throw new BadRequestException(
        `Invalid state transition: cannot "${action}" from status "${currentStatus}". ` +
          `Expected one of: [${allowed?.join(', ')}]`,
      );
    }
  }

  // ─── Trustless Work Escrow Flow ────────────────────────────────────────────

  /**
   * PURE CHAIN OPERATION: Deploy escrow contract + build unsigned fund XDR.
   *
   * Does NOT read or write to the database. Intended to be called by
   * OrderService.create() so the escrow is deployed before any DB record is saved.
   * If TW fails, no Order or EscrowOnChain record will exist in the database.
   *
   * @param orderId  Pre-generated UUID used as both the order PK and TW engagementId
   * @param dto      Escrow parameters (addresses, amount, asset, title)
   */
  async deployEscrowToChain(
    orderId: string,
    dto: Pick<
      OpenEscrowDto,
      'sellerAddress' | 'buyerAddress' | 'amount' | 'assetCode' | 'title'
    >,
  ): Promise<{ contractId: string; unsignedFundTransaction: string }> {
    this.validateAssetCode(dto.assetCode);
    const treasury = this.config.getOrThrow<string>('IKASH_TREASURY_ADDRESS');
    const deployerSecret = this.config.getOrThrow<string>(
      'IKASH_DEPLOYER_SECRET',
    );
    const platformFee = Number(
      this.config.get<string>('IKASH_PLATFORM_FEE', '1'),
    );

    // ─ STEP 1: Build the deploy payload with canonical types ─────────────────
    const deployPayload: InitializeMultiReleaseEscrowPayload = {
      signer: treasury,
      engagementId: orderId,
      title: dto.title ?? `iKash P2P Order ${orderId}`,
      description: `iKash P2P escrow for order ${orderId}`,
      roles: this.buildP2PRoles(dto.sellerAddress, dto.buyerAddress),
      platformFee,
      milestones: [
        {
          description: 'P2P fiat-to-crypto exchange',
          amount: Number(dto.amount),
          receiver: dto.buyerAddress,
        },
      ],
      trustline: this.resolveTrustline(dto.assetCode),
    };

    const deployResult = await this.tw.initializeEscrow(deployPayload);

    // Backend signs + broadcasts the deploy — no user signature needed
    const broadcastResult = await this.tw.signAndBroadcast(
      deployResult.unsignedTransaction,
      deployerSecret,
      this.getNetworkPassphrase(),
    );

    if (broadcastResult.status !== 'SUCCESS' || !broadcastResult.contractId) {
      throw new BadRequestException({
        error: 'EscrowDeployFailed',
        message:
          broadcastResult.message ?? 'Escrow contract deployment failed',
        details: broadcastResult,
      });
    }

    const { contractId } = broadcastResult;
    this.logger.log(
      `Escrow deployed: contractId=${contractId} for order ${orderId}`,
    );

    // ─ STEP 2: Build fund XDR for the seller to sign ──────────────────────
    const fundResult = await this.tw.fundEscrow({
      contractId,
      signer: dto.sellerAddress,
      amount: Number(dto.amount),
    });

    return {
      contractId,
      unsignedFundTransaction: fundResult.unsignedTransaction,
    };
  }

  /**
   * COMBINED STEP 1+2: Open escrow (deploy + prepare fund XDR) in one call.
   *
   * Used when an order already exists in DB and the escrow needs to be opened
   * separately (e.g., merchant accepting a buy offer).
   */
  async open(dto: OpenEscrowDto) {
    const existing = await this.repo.findByOrder(dto.orderId);
    if (existing?.contractId) {
      throw new BadRequestException(
        'An escrow contract already exists for this order',
      );
    }

    const { contractId, unsignedFundTransaction } =
      await this.deployEscrowToChain(dto.orderId, dto);

    let escrow = existing;
    if (!escrow) {
      escrow = await this.repo.create({
        orderId: dto.orderId,
        buyerAddress: dto.buyerAddress,
        sellerAddress: dto.sellerAddress,
        amount: dto.amount,
        escrowStatus: 'initialized',
      });
    }
    await this.repo.update(escrow!.escrowId, {
      contractId,
      escrowStatus: 'initialized',
    });

    return {
      escrowId: escrow!.escrowId,
      contractId,
      unsignedFundTransaction,
    };
  }

  /**
   * STEP 1: Initialize escrow (advanced / manual use)
   *
   * Returns an unsigned XDR for the client wallet to sign.
   * The deploy will be signed by the user (vs. deployEscrowToChain which uses
   * the backend deployer key).
   */
  async initialize(dto: InitializeEscrowDto) {
    this.validateAssetCode(dto.assetCode);
    const existing = await this.repo.findByOrder(dto.orderId);
    if (existing?.contractId) {
      throw new BadRequestException(
        'An escrow contract already exists for this order',
      );
    }

    const platformFee = Number(
      this.config.get<string>('IKASH_PLATFORM_FEE', '1'),
    );

    const payload: InitializeMultiReleaseEscrowPayload = {
      signer: dto.signerAddress,
      engagementId: dto.orderId,
      title: dto.title,
      description: `iKash P2P escrow for order ${dto.orderId}`,
      roles: this.buildP2PRoles(dto.sellerAddress, dto.buyerAddress),
      platformFee,
      milestones: [
        {
          description: 'P2P fiat-to-crypto exchange',
          amount: Number(dto.amount),
          receiver: dto.buyerAddress,
        },
      ],
      trustline: this.resolveTrustline(dto.assetCode),
    };

    const result = await this.tw.initializeEscrow(payload);

    let escrow = await this.repo.findByOrder(dto.orderId);
    if (!escrow) {
      escrow = await this.repo.create({
        orderId: dto.orderId,
        buyerAddress: dto.buyerAddress,
        sellerAddress: dto.sellerAddress,
        amount: dto.amount,
        escrowStatus: 'pending',
      });
    } else {
      await this.repo.update(escrow.escrowId, {
        buyerAddress: dto.buyerAddress,
        sellerAddress: dto.sellerAddress,
        amount: dto.amount,
      });
    }

    return {
      escrowId: escrow?.escrowId,
      unsignedTransaction: result.unsignedTransaction,
    };
  }

  /**
   * STEP 2: Fund escrow
   *
   * Seller deposits tokens into the escrow contract.
   * Returns an unsigned XDR for client-side wallet signing.
   */
  async fund(dto: FundEscrowDto) {
    const escrow = await this.getOrFail(dto.escrowId);

    if (!escrow.contractId) {
      throw new BadRequestException(
        'Escrow has not been initialized on-chain yet. Complete the initialize step first.',
      );
    }
    if (escrow.escrowStatus !== 'initialized') {
      throw new BadRequestException(
        `Cannot fund escrow in status "${escrow.escrowStatus}". Must be "initialized".`,
      );
    }

    const result = await this.tw.fundEscrow({
      contractId: escrow.contractId,
      signer: dto.signerAddress,
      amount: Number(dto.amount),
    });

    return {
      escrowId: escrow.escrowId,
      unsignedTransaction: result.unsignedTransaction,
    };
  }

  /**
   * STEP 2.1: Mark Fiat Sent (Buyer)
   *
   * Buyer confirms they sent the bank transfer and uploads evidence on-chain.
   * Buyer is the `serviceProvider` in the TW contract, so they call
   * changeMilestoneStatus to mark it 'completed', unlocking the seller's release.
   */
  async markFiatSent(id: string, dto: FiatSentDto) {
    const escrow = await this.getOrFail(id);

    if (!['funded', 'fiat_sent'].includes(escrow.escrowStatus)) {
      throw new BadRequestException(
        `Cannot mark fiat sent for escrow in status "${escrow.escrowStatus}". Must be "funded" or "fiat_sent".`,
      );
    }

    const result = await this.tw.changeMilestoneStatus({
      contractId: escrow.contractId!,
      serviceProvider: dto.buyerAddress,
      milestoneIndex: '0',
      newStatus: 'completed',
      newEvidence: dto.evidence || 'Fiat payment sent by buyer',
    });

    return {
      escrowId: escrow.escrowId,
      unsignedTransaction: result.unsignedTransaction,
    };
  }

  /**
   * STEP 3: Release escrow funds
   *
   * Seller confirms fiat receipt and signs the release.
   * If the milestone is 'completed' (not yet 'approved'), the platform
   * auto-approves using its treasury key before building the release XDR.
   */
  async release(dto: ReleaseEscrowDto) {
    const escrow = await this.getOrFail(dto.escrowId);

    if (!escrow.contractId) {
      throw new BadRequestException('Escrow has no on-chain contract');
    }
    if (!['funded', 'fiat_sent'].includes(escrow.escrowStatus)) {
      throw new BadRequestException(
        `Cannot release escrow in status "${escrow.escrowStatus}". Must be "funded" or "fiat_sent".`,
      );
    }

    const statusRes = await this.tw.getEscrowByContractId(
      escrow.contractId,
      true,
    );
    const milestoneState = statusRes?.[0]?.milestones?.[0]?.status;

    if (milestoneState === 'completed') {
      this.logger.log(
        `Auto-approving milestone for escrow ${dto.escrowId} before release…`,
      );
      const treasury = this.config.getOrThrow<string>('IKASH_TREASURY_ADDRESS');
      const treasurySecret = this.config.getOrThrow<string>(
        'IKASH_DEPLOYER_SECRET',
      );

      const approveXdr = await this.tw.approveMilestone({
        contractId: escrow.contractId,
        approver: treasury,
        milestoneIndex: '0',
      });

      const broadcastResult = await this.tw.signAndBroadcast(
        approveXdr.unsignedTransaction,
        treasurySecret,
        this.getNetworkPassphrase(),
      );

      if (broadcastResult.status !== 'SUCCESS') {
        throw new InternalServerErrorException(
          `Auto-approve failed: ${broadcastResult.message}`,
        );
      }
    }

    const result = await this.tw.releaseMilestoneFunds({
      contractId: escrow.contractId,
      releaseSigner: dto.releaseSigner,
      milestoneIndex: '0',
    });

    return {
      escrowId: escrow.escrowId,
      unsignedTransaction: result.unsignedTransaction,
    };
  }

  /**
   * SYNC: Broadcast a wallet-signed XDR and update DB state.
   *
   * The frontend sends the XDR signed by the user's wallet. The backend
   * broadcasts it via TW and updates local status accordingly.
   */
  async syncTransaction(dto: SyncEscrowDto) {
    const escrow = await this.getOrFail(dto.escrowId);

    this.validateStatusTransition(escrow.escrowStatus, dto.action);

    const result = await this.tw.sendTransaction(dto.signedXdr);
    if (result.status !== 'SUCCESS') {
      throw new InternalServerErrorException(
        `Blockchain sync failed: ${result.message || 'Unknown error'}`,
      );
    }

    const updateData: Record<string, unknown> = {};

    switch (dto.action) {
      case EscrowAction.INITIALIZE:
        updateData.escrowStatus = 'initialized';
        if (result.contractId) updateData.contractId = result.contractId;
        updateData.txHashLock = dto.signedXdr.substring(0, 64);
        break;

      case EscrowAction.FUND:
        updateData.escrowStatus = 'funded';
        break;

      case EscrowAction.FIAT_SENT:
        updateData.escrowStatus = 'fiat_sent';
        break;

      case EscrowAction.RELEASE:
        updateData.escrowStatus = 'released';
        updateData.txHashRelease = dto.signedXdr.substring(0, 64);
        break;
    }

    await this.repo.update(dto.escrowId, updateData);

    return {
      escrowId: dto.escrowId,
      status: result.status,
      contractId: result.contractId ?? escrow.contractId,
      newEscrowStatus: updateData.escrowStatus,
    };
  }

  /**
   * Get escrow status with optional on-chain balance enrichment.
   */
  async getStatus(id: string) {
    const escrow = await this.getOrFail(id);

    const response: Record<string, unknown> = {
      ...escrow,
      onChainBalance: null,
      onChainData: null,
    };

    if (escrow.contractId) {
      try {
        const [balanceRes, onChainRes] = await Promise.allSettled([
          this.tw.getEscrowBalance(escrow.contractId),
          this.tw.getEscrowByContractId(escrow.contractId, true),
        ]);

        if (balanceRes.status === 'fulfilled') {
          response.onChainBalance = balanceRes.value;
        }
        if (onChainRes.status === 'fulfilled') {
          response.onChainData = onChainRes.value;
        }
      } catch (err) {
        this.logger.warn(
          `Could not fetch on-chain data for escrow ${id}: ${err}`,
        );
      }
    }

    return response;
  }

  // ─── Legacy CRUD (backward compatibility) ──────────────────────────────────

  async create(dto: CreateEscrowDto) {
    const exists = await this.repo.findByOrder(dto.orderId);
    if (exists) throw new BadRequestException('Ya existe escrow para ese orderId');
    return this.repo.create(dto);
  }

  list(p: PaginationDto, orderId?: string) {
    if (orderId) {
      return this.repo.findMany({
        skip: p.skip,
        take: p.take,
        where: { orderId },
      });
    }
    return this.repo.findMany({ skip: p.skip, take: p.take });
  }

  async get(id: string) {
    const item = await this.repo.findById(id);
    if (!item) throw new NotFoundException('Escrow no encontrado');
    return item;
  }

  update(id: string, dto: UpdateEscrowDto) {
    return this.repo.update(id, dto);
  }

  remove(id: string) {
    return this.repo.delete(id);
  }
}