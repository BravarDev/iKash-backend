import { Injectable } from '@nestjs/common';
import { BaseRepository } from '../../common/base.repository';
import { PrismaService } from '../../../prisma/prisma.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class OrderRepository extends BaseRepository {
  constructor(private readonly prisma: PrismaService) {
    super(prisma.order, 'orderId');
  }

  // Override create to atomically create order+escrow and mark the offer as executed.
  // Accepts an optional pre-generated orderId so the same UUID can be used as the
  // Trustless Work engagementId before any DB record is persisted.
  async create(data: {
    orderId?: string;            // optional pre-generated UUID
    offerId: string;
    buyerId: string;
    sellerId: string;
    assetAmount: string | number;
    fiatAmount: string | number;
    orderStatus?: string;
    expiresAt?: Date | string | null;
    // Escrow data to persist alongside the order
    escrow?: {
      contractId: string;
      sellerAddress: string;
      buyerAddress: string;
      amount: string | number;
    };
  }) {
    const created = await this.prisma.$transaction(async (tx) => {
      const payload: Prisma.OrderUncheckedCreateInput = {
        ...(data.orderId ? { orderId: data.orderId } : {}),
        offerId: data.offerId,
        buyerId: data.buyerId,
        sellerId: data.sellerId,
        assetAmount: data.assetAmount as any,
        fiatAmount: data.fiatAmount as any,
        orderStatus: (data.orderStatus as any) || undefined,
        expiresAt: data.expiresAt ? new Date(data.expiresAt as string) : undefined,
      } as Prisma.OrderUncheckedCreateInput;

      const order = await tx.order.create({ data: payload });

      // Persist escrow record atomically with the order if data is provided
      if (data.escrow) {
        await tx.escrowOnChain.create({
          data: {
            orderId: order.orderId,
            contractId: data.escrow.contractId,
            sellerAddress: data.escrow.sellerAddress,
            buyerAddress: data.escrow.buyerAddress,
            amount: data.escrow.amount as any,
            escrowStatus: 'initialized',
          },
        });
      }

      // Mark the offer as executed so it no longer appears in the active market
      await tx.offer.update({ where: { offerId: data.offerId }, data: { executed: true } });
      return order;
    });

    return created;
  }

  search(where: any, skip = 0, take = 20) {
    return this.prisma.order.findMany({
      where,
      skip,
      take,
      orderBy: { orderId: 'desc' },
      include: {
        offer: {
          include: {
            payment_methods: {
              include: {
                payment_provider: true,
              },
            },
          },
        },
        escrow: true,
        buyer: true,
        seller: true,
      },
    });
  }

  findById(id: string) {
    return this.prisma.order.findUnique({
      where: { orderId: id },
      include: {
        offer: {
          include: {
            payment_methods: {
              include: {
                payment_provider: true,
              },
            },
          },
        },
        escrow: true,
        buyer: true,
        seller: true,
      },
    });
  }

  async getUserStats(userId: string) {
    const totalOrders = await this.prisma.order.count({
      where: {
        OR: [{ buyerId: userId }, { sellerId: userId }],
      },
    });

    const completedOrders = await this.prisma.order.count({
      where: {
        OR: [{ buyerId: userId }, { sellerId: userId }],
        orderStatus: 'released',
      },
    });

    return { totalOrders, completedOrders };
  }
}