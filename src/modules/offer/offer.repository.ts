import { Injectable } from '@nestjs/common';
import { BaseRepository } from '../../common/base.repository';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class OfferRepository extends BaseRepository {
  constructor(private readonly prisma: PrismaService) {
    super(prisma.offer, 'offerId');
  }

  async create(data: any) {
    const { paymentMethodIds, ...offerData } = data;

    const connectPaymentMethods: any = {};

    if (paymentMethodIds && paymentMethodIds.length > 0) {
      const v2Methods = await this.prisma.paymentMethod.findMany({
        where: { paymentId: { in: paymentMethodIds } },
        select: { paymentId: true },
      });
      if (v2Methods.length > 0) {
        connectPaymentMethods.connect = v2Methods.map(m => ({ paymentId: m.paymentId }));
      }
    }

    return this.prisma.offer.create({
      data: {
        ...offerData,
        payment_methods: connectPaymentMethods.connect ? connectPaymentMethods : undefined,
      },
      include: {
        payment_methods: {
          include: { payment_provider: true },
        },
      },
    });
  }

  findById(offerId: string) {
    return this.prisma.offer.findUnique({
      where: { offerId },
      include: {
        payment_methods: {
          include: { payment_provider: true },
        },
      },
    });
  }

  search(where: any, skip = 0, take = 20) {
    return this.prisma.offer.findMany({
      where,
      skip,
      take,
      orderBy: { offerId: 'desc' },
      include: {
        payment_methods: {
          include: { payment_provider: true },
        },
      },
    });
  }
}