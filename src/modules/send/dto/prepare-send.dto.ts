import { IsString, Matches, MinLength } from 'class-validator';
import { AMOUNT_REGEX } from '../../../lib/constants/regex';

export class PrepareSendDto {
  // User alias or Stellar address (G...)
  @IsString()
  @MinLength(1)
  recipient!: string;

  // Amount to send in USDC (up to 7 decimals)
  @IsString()
  @Matches(AMOUNT_REGEX, {
    message: 'Invalid amount. e.g. "1" or "0.1234567"',
  })
  amount!: string;
}
