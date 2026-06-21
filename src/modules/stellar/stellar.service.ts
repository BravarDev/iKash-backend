import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Asset,
  BASE_FEE,
  Horizon,
  Keypair,
  Memo,
  Networks,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import { AppException, ErrorCode } from '../../common/errors';

type NetworkType = 'testnet' | 'public';

@Injectable()
export class StellarService {
  private readonly server: Horizon.Server;
  private readonly networkPassphrase: string;
  private readonly signerSecret?: string;

  constructor(private readonly config: ConfigService) {
    const horizonUrl =
      this.config.get<string>('STELLAR_HORIZON_URL') ??
      'https://horizon-testnet.stellar.org';

    const network = (this.config.get<string>('STELLAR_NETWORK') ??
      'testnet') as NetworkType;

    this.networkPassphrase =
      network === 'public' ? Networks.PUBLIC : Networks.TESTNET;

    this.signerSecret = this.config.get<string>('STELLAR_SIGNER_SECRET');

    this.server = new Horizon.Server(horizonUrl);
  }

  async getAccount(publicKey: string) {
    this.assertPublicKey(publicKey);
    return this.server.loadAccount(publicKey);
  }

  async getBalances(publicKey: string) {
    const account = await this.getAccount(publicKey);

    return account.balances.map((b: any) => ({
      asset_type: b.asset_type,
      asset_code: b.asset_code ?? null,
      asset_issuer: b.asset_issuer ?? null,
      balance: b.balance,
      limit: b.limit ?? null,
    }));
  }

  async getTransactions(publicKey: string, limit = 10) {
    this.assertPublicKey(publicKey);

    try {
      const res = await this.server
        .payments()
        .forAccount(publicKey)
        .order('desc')
        .limit(Math.min(Math.max(limit, 1), 200))
        .call();

      return res.records.map((op: any) => ({
        id: op.id,
        transaction_hash: op.transaction_hash,
        created_at: op.created_at,
        type: op.type,
        amount: op.amount ?? null,
        asset: op.asset_type === 'native' ? 'XLM' : (op.asset_code ?? null),
        asset_issuer: op.asset_issuer ?? null,
        from: op.from ?? op.funder ?? null,
        to: op.to ?? op.account ?? null,
        direction:
          op.to === publicKey || op.account === publicKey ? 'received' : 'sent',
      }));
    } catch (err: any) {
      if (err?.response?.status === 404) {
        throw new AppException(
          ErrorCode.STELLAR_ACCOUNT_NOT_FOUND,
          `Account ${publicKey} not found on Stellar network.`,
        );
      }
      throw new AppException(
        ErrorCode.STELLAR_TRANSACTION_FAILED,
        'Failed to fetch transactions from Stellar network.',
      );
    }
  }

  /**
   * Sends a payment signed by the backend wallet.
   * For production, prefer client-side signing or KMS/HSM custody.
   */
  async sendPayment(params: {
    destination: string;
    amount: string;
    memo?: string;
    asset?: { code: string; issuer?: string };
  }) {
    if (!this.signerSecret) {
      throw new AppException(
        ErrorCode.MISSING_SIGNER_SECRET,
        'STELLAR_SIGNER_SECRET is not configured for signing transactions.',
      );
    }

    this.assertPublicKey(params.destination);
    this.assertAmount(params.amount);

    const sourceKeypair = Keypair.fromSecret(this.signerSecret);
    const sourcePublicKey = sourceKeypair.publicKey();

    const account = await this.server.loadAccount(sourcePublicKey);
    const asset = this.buildAsset(params.asset);

    let builder = new TransactionBuilder(account, {
      fee: String(BASE_FEE),
      networkPassphrase: this.networkPassphrase,
    }).addOperation(
      Operation.payment({
        destination: params.destination,
        asset,
        amount: params.amount,
      }),
    );

    if (params.memo) {
      builder = builder.addMemo(Memo.text(params.memo));
    }

    const tx = builder.setTimeout(60).build();
    tx.sign(sourceKeypair);
    const res = await this.server.submitTransaction(tx);

    return {
      hash: res.hash,
      ledger: res.ledger,
      successful: res.successful,
    };
  }

  private buildAsset(asset?: { code: string; issuer?: string }) {
    if (!asset || asset.code === 'XLM') return Asset.native();

    if (!asset.issuer) {
      throw new AppException(
        ErrorCode.MISSING_ASSET_ISSUER,
        'Non-native assets require an issuer address (e.g. the USDC issuer).',
      );
    }

    this.assertPublicKey(asset.issuer);
    return new Asset(asset.code, asset.issuer);
  }

  private assertPublicKey(key: string) {
    if (!key || key[0] !== 'G' || key.length < 50) {
      throw new AppException(
        ErrorCode.INVALID_STELLAR_ADDRESS,
        'Invalid public key. Must start with "G" and be at least 50 characters.',
      );
    }
  }

  private assertAmount(amount: string) {
    if (!/^\d+(\.\d{1,7})?$/.test(amount) || Number(amount) <= 0) {
      throw new AppException(
        ErrorCode.INVALID_AMOUNT,
        'Invalid amount. Use a positive number with up to 7 decimal places (e.g. "1" or "0.1234567").',
      );
    }
  }
}
