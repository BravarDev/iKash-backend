import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StellarService } from '../stellar/stellar.service';
import { UsersRepository } from '../users/users.repository';
import { AMOUNT_REGEX } from '../../lib/constants/regex';

const STROOPS_PER_UNIT = 10_000_000n; // USDC uses 7 decimals

@Injectable()
export class SendService {
  constructor(
    private readonly config: ConfigService,
    private readonly stellar: StellarService,
    private readonly users: UsersRepository,
  ) {}

  /** Resolves an alias or address and returns recipient info for confirmation. */
  async resolveRecipient(recipient: string) {
    const { address, alias } = await this.resolve(recipient);

    let exists = false;
    let hasUsdcTrustline = false;
    try {
      const balances = await this.stellar.getBalances(address);
      exists = true;
      hasUsdcTrustline = balances.some((b: any) => b.asset_code === 'USDC');
    } catch {
      // loadAccount throws if the account does not exist on the network
      exists = false;
    }

    return { address, alias, exists, hasUsdcTrustline };
  }

  /** Validates, calculates the 0.3% fee and builds the unsigned USDC transaction. */
  async prepare(sourcePublicKey: string, recipient: string, amount: string) {
    const { address, alias } = await this.resolve(recipient);

    if (address === sourcePublicKey) {
      throw new BadRequestException('You cannot send funds to yourself.');
    }

    const amountStroops = this.toStroops(amount);
    if (amountStroops <= 0n) {
      throw new BadRequestException('The amount must be greater than 0.');
    }

    const feeStroops = (amountStroops * BigInt(this.feeBps())) / 10_000n;
    if (feeStroops <= 0n) {
      throw new BadRequestException(
        'The amount is too small to calculate the 0.3% fee.',
      );
    }

    const feeAddress = this.feeCollector();
    const normalizedAmount = this.fromStroops(amountStroops);
    const feeAmount = this.fromStroops(feeStroops);
    const total = this.fromStroops(amountStroops + feeStroops);

    const { xdr, networkPassphrase } = await this.stellar.buildUnsignedUsdcSend({
      sourcePublicKey,
      destination: address,
      amount: normalizedAmount,
      feeAddress,
      feeAmount,
    });

    return {
      recipient: { address, alias },
      asset: 'USDC',
      amount: normalizedAmount,
      fee: feeAmount,
      total,
      unsignedXdr: xdr,
      networkPassphrase,
    };
  }

  /** Submits the transaction already signed by the frontend to Stellar. */
  async submit(signedXdr: string) {
    return this.stellar.submitSignedXdr(signedXdr);
  }

  // --- helpers ---

  /** Resolves a recipient (alias or G... address) to { address, alias }. */
  private async resolve(
    recipient: string,
  ): Promise<{ address: string; alias: string | null }> {
    const value = recipient.trim();

    if (this.isStellarAddress(value)) {
      const user = await this.users.findByPublicKey(value);
      return { address: value, alias: user?.alias ?? null };
    }

    const user = await this.users.findByAlias(value);
    if (!user) {
      throw new NotFoundException(
        `No wallet was found for the alias "${value}".`,
      );
    }
    return { address: user.publicKey, alias: user.alias };
  }

  private isStellarAddress(value: string): boolean {
    return value.length === 56 && value[0] === 'G';
  }

  /** 0.3% in basis points (30 bps), configurable via SEND_CRYPTO_FEE_PERCENT. */
  private feeBps(): number {
    const percent = Number(
      this.config.get<string>('SEND_CRYPTO_FEE_PERCENT') ?? '0.3',
    );
    if (!Number.isFinite(percent) || percent < 0) {
      return 30;
    }
    return Math.round(percent * 100); // 0.3% -> 30 bps
  }

  private feeCollector(): string {
    const address = this.config.get<string>('IKASH_TREASURY_ADDRESS');
    if (!address) {
      throw new BadRequestException(
        'IKASH_TREASURY_ADDRESS is missing to charge the fee.',
      );
    }
    return address;
  }

  /** Converts a decimal amount (string) to stroops (BigInt), 7 decimals. */
  private toStroops(amount: string): bigint {
    if (!AMOUNT_REGEX.test(amount)) {
      throw new BadRequestException('Invalid amount. e.g. "1" or "0.1234567"');
    }
    const [intPart, decPart = ''] = amount.split('.');
    const decPadded = decPart.padEnd(7, '0');
    return BigInt(intPart) * STROOPS_PER_UNIT + BigInt(decPadded);
  }

  /** Converts stroops (BigInt) to a 7-decimal string, trimming trailing zeros. */
  private fromStroops(stroops: bigint): string {
    const intPart = stroops / STROOPS_PER_UNIT;
    const decPart = stroops % STROOPS_PER_UNIT;
    if (decPart === 0n) return intPart.toString();
    const decStr = decPart.toString().padStart(7, '0').replace(/0+$/, '');
    return `${intPart.toString()}.${decStr}`;
  }
}
