import { IsString, IsNumber, IsUUID, Min, IsOptional } from 'class-validator';

export class InitializeEscrowDto {
  @IsUUID()
  orderId: string;

  /** Stellar public key of the entity signing the deploy tx */
  @IsString()
  signerAddress: string;

  /**
   * Seller's Stellar public key.
   *
   * TW role mapping:
   *   - releaseSigner → seller (releases crypto once fiat is confirmed)
   *
   * NOT serviceProvider — that role belongs to the buyer in the P2P flow.
   */
  @IsString()
  sellerAddress: string;

  /**
   * Buyer's Stellar public key.
   *
   * TW role mapping:
   *   - serviceProvider → buyer (delivers the fiat "service")
   *   - receiver (at milestone level) → buyer (receives the crypto on release)
   */
  @IsString()
  buyerAddress: string;

  /** Amount for the escrow in the asset's unit */
  @IsNumber()
  @Min(0.0000001)
  amount: number;

  /** Human-readable title for the escrow contract */
  @IsString()
  title: string;

  /**
   * Asset code being exchanged (e.g., 'XLM', 'USDC', 'native').
   * Defaults to USDC if omitted.
   * For XLM/native, trustline is sent as { address: '', symbol: 'XLM' }.
   */
  @IsString()
  @IsOptional()
  assetCode?: string;
}
