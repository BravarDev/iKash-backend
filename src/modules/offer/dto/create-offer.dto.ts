import { IsArray, IsIn, IsNumberString, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateOfferDto {
  @IsUUID()
  creatorId: string;

  @IsIn(['buy', 'sell'])
  type: 'buy' | 'sell';

  @IsString()
  assetCode: string;

  @IsNumberString()
  price: string;

  @IsNumberString()
  minAmount: string;

  @IsNumberString()
  maxAmount: string;

  @IsOptional()
  @IsIn(['active', 'paused', 'closed'])
  status?: 'active' | 'paused' | 'closed';

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  paymentMethodIds?: string[];
}