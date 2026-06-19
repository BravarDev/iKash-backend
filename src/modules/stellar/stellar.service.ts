import { Injectable, BadRequestException, InternalServerErrorException, NotFoundException } from '@nestjs/common';
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
        direction: (op.to === publicKey || op.account === publicKey) ? 'received' : 'sent',
      }));
    } catch (err: any) {
      if (err?.response?.status === 404) {
        throw new NotFoundException(`Account ${publicKey} not found on Stellar network.`);
      }
      throw new InternalServerErrorException('Failed to fetch transactions from Stellar network.');
    }
  }

  /**
   * Envía un pago firmado por tu backend.
   * Para producción: mejor firmar del lado cliente o custodiar secreto con KMS/HSM.
   */
  async sendPayment(params: {
    destination: string;
    amount: string; // "1.5"
    memo?: string;
    asset?: { code: string; issuer?: string }; // si no viene => XLM
  }) {
    if (!this.signerSecret) {
      throw new BadRequestException(
        'Falta STELLAR_SIGNER_SECRET para firmar la transacción.',
      );
    }

    this.assertPublicKey(params.destination);
    this.assertAmount(params.amount);

    const sourceKeypair = Keypair.fromSecret(this.signerSecret);
    const sourcePublicKey = sourceKeypair.publicKey();

    // Cargar cuenta origen
    const account = await this.server.loadAccount(sourcePublicKey);

    // Asset (XLM o token)
    const asset = this.buildAsset(params.asset);

    // Construcción TX
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
      // Memo text: límite aprox 28 bytes
      builder = builder.addMemo(Memo.text(params.memo));
    }

    const tx = builder.setTimeout(60).build();

    // Firmar + enviar
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
      throw new BadRequestException(
        'Para assets no nativos debes enviar issuer (ej: USDC issuer).',
      );
    }

    this.assertPublicKey(asset.issuer);
    return new Asset(asset.code, asset.issuer);
  }

  private assertPublicKey(key: string) {
    // validación simple (evita dependencias extra)
    if (!key || key[0] !== 'G' || key.length < 50) {
      throw new BadRequestException('Public key inválida (debe iniciar con G...).');
    }
  }

  private assertAmount(amount: string) {
    // Stellar usa hasta 7 decimales, y debe ser > 0
    if (!/^\d+(\.\d{1,7})?$/.test(amount) || Number(amount) <= 0) {
      throw new BadRequestException('Amount inválido. Ej: "1" o "0.1234567"');
    }
  }
}