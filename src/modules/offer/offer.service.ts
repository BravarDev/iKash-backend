import { HttpStatus, Injectable } from '@nestjs/common';
import { PaginationDto } from '../../common/pagination.dto';
import { CreateOfferDto } from './dto/create-offer.dto';
import { UpdateOfferDto } from './dto/update-offer.dto';
import { OfferRepository } from './offer.repository';
import { AppException, ErrorCode } from '../../common/errors';

@Injectable()
export class OfferService {
  constructor(private readonly repo: OfferRepository) {}

  create(dto: CreateOfferDto) {
    return this.repo.create(dto);
  }

  list(p: PaginationDto, q: any) {
    const where: any = {};
    if (q.creatorId) where.creatorId = q.creatorId;
    if (q.status) where.status = q.status;
    if (q.type) where.type = q.type;
    if (q.assetCode) where.assetCode = q.assetCode;

    return this.repo.search(where, p.skip, p.take);
  }

  async get(id: string) {
    const item = await this.repo.findById(id);
    if (!item) {
      throw new AppException(
        ErrorCode.OFFER_NOT_FOUND,
        `Offer ${id} not found`,
        HttpStatus.NOT_FOUND,
      );
    }
    return item;
  }

  update(id: string, dto: UpdateOfferDto) {
    return this.repo.update(id, dto);
  }

  remove(id: string) {
    return this.repo.delete(id);
  }
}
