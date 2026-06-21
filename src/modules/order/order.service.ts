import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PaginationDto } from '../../common/pagination.dto';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { OrderRepository } from './order.repository';
import { EscrowService } from '../escrow/escrow.service';
import { AppException, ErrorCode } from '../../common/errors';

@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);

  constructor(
    private readonly repo: OrderRepository,
    private readonly escrowService: EscrowService,
  ) {}

  /**
   * Atomic order + escrow creation.
   *
   * 1. Pre-generate an orderId (UUIDv4).
   * 2. Call EscrowService.deployEscrowToChain() — interacts ONLY with TW API.
   *    If this fails the method throws and NO database record is created.
   * 3. Persist Order + EscrowOnChain in a single DB transaction.
   * 4. Return the order data with the unsigned fund XDR so the frontend can
   *    prompt the seller to sign.
   */
  async create(dto: CreateOrderDto) {
    const orderId = randomUUID();

    this.logger.log(
      `Creating order ${orderId} — deploying escrow to chain first…`,
    );

    const { contractId, unsignedFundTransaction } =
      await this.escrowService.deployEscrowToChain(orderId, {
        sellerAddress: dto.sellerAddress,
        buyerAddress: dto.buyerAddress,
        amount: Number(dto.assetAmount),
        assetCode: dto.assetCode,
        title: dto.title ?? `Order ${orderId}`,
      });

    this.logger.log(
      `Escrow deployed (contract=${contractId}). Persisting order + escrow in DB…`,
    );

    const data: any = {
      orderId,
      offerId: dto.offerId,
      buyerId: dto.buyerId,
      sellerId: dto.sellerId,
      assetAmount: dto.assetAmount,
      fiatAmount: dto.fiatAmount,
      orderStatus: dto.orderStatus,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
      escrow: {
        contractId,
        sellerAddress: dto.sellerAddress,
        buyerAddress: dto.buyerAddress,
        amount: dto.assetAmount,
      },
    };

    const order = await this.repo.create(data);

    this.logger.log(`Order ${orderId} and escrow persisted successfully.`);

    return { ...order, contractId, unsignedFundTransaction };
  }

  list(p: PaginationDto, q: any) {
    const where: any = {};
    if (q.offerId) where.offerId = q.offerId;
    if (q.buyerId) where.buyerId = q.buyerId;
    if (q.sellerId) where.sellerId = q.sellerId;
    if (q.userId) {
      where.OR = [{ buyerId: q.userId }, { sellerId: q.userId }];
    }
    if (q.status) where.orderStatus = q.status;

    return this.repo.search(where, p.skip, p.take);
  }

  async get(id: string) {
    const item = await this.repo.findById(id);
    if (!item) {
      throw new AppException(ErrorCode.ORDER_NOT_FOUND, `Order ${id} not found`);
    }
    return item;
  }

  update(id: string, dto: UpdateOrderDto) {
    const data: any = { ...dto };
    if (dto.expiresAt) data.expiresAt = new Date(dto.expiresAt);
    return this.repo.update(id, data);
  }

  remove(id: string) {
    return this.repo.delete(id);
  }

  getUserStats(userId: string) {
    return this.repo.getUserStats(userId);
  }
}
