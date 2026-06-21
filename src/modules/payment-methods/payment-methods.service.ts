import { Injectable } from '@nestjs/common';
import { PaginationDto } from '../../common/pagination.dto';
import { CreatePaymentMethodDto } from './dto/create-payment-method.dto';
import { UpdatePaymentMethodDto } from './dto/update-payment-method.dto';
import { PaymentMethodsRepository } from './payment-methods.repository';
import { AppException, ErrorCode } from '../../common/errors';

@Injectable()
export class PaymentMethodsService {
  constructor(private readonly repo: PaymentMethodsRepository) {}

  create(dto: CreatePaymentMethodDto) {
    return this.repo.create(dto);
  }

  list(p: PaginationDto) {
    return this.repo.findMany({ skip: p.skip, take: p.take });
  }

  async get(id: string) {
    const item = await this.repo.findById(id);
    if (!item) {
      throw new AppException(
        ErrorCode.PAYMENT_METHOD_NOT_FOUND,
        `Payment method ${id} not found`,
      );
    }
    return item;
  }

  update(id: string, dto: UpdatePaymentMethodDto) {
    return this.repo.update(id, dto);
  }

  remove(id: string) {
    return this.repo.delete(id);
  }
}
