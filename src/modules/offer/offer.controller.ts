import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { PaginationDto } from '../../common/pagination.dto';
import { CreateOfferDto } from './dto/create-offer.dto';
import { UpdateOfferDto } from './dto/update-offer.dto';
import { OfferService } from './offer.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { KycVerifiedGuard } from '../../common/kyc-verified.guard';

@Controller('offers')
export class OfferController {
  constructor(private readonly service: OfferService) {}

  @Post()
  @UseGuards(JwtAuthGuard, KycVerifiedGuard)
  create(@Body() dto: CreateOfferDto) {
    return this.service.create(dto);
  }

  @Get()
  list(@Query() p: PaginationDto, @Query() q: any) {
    return this.service.list(p, q);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, KycVerifiedGuard)
  update(@Param('id') id: string, @Body() dto: UpdateOfferDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, KycVerifiedGuard)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}