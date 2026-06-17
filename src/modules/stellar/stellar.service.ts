import { Injectable, BadRequestException } from '@nestjs/common';
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
} from 'stellar-sdk';

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

  /** Passphrase de la red configurada (testnet/public). */
  getNetworkPassphrase() {
    return this.networkPassphrase;
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

    const res = await this.server
      .transactions()
      .forAccount(publicKey)
      .order('desc')
      .limit(Math.min(Math.max(limit, 1), 200))
      .call();

    return res.records.map((t: any) => ({
      id: t.id,
      hash: t.hash,
      created_at: t.created_at,
      memo_type: t.memo_type,
      memo: t.memo,
      successful: t.successful,
      fee_charged: t.fee_charged,
      source_account: t.source_account,
    }));
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

  /**
   * Arma una transacción USDC SIN firmar para el flujo Send Crypto.
   * Incluye un pago al destinatario y un segundo pago con el fee al colector.
   * El frontend firma el XDR resultante; el backend solo lo construye.
   */
  async buildUnsignedUsdcSend(params: {
    sourcePublicKey: string;
    destination: string;
    amount: string;
    feeAddress: string;
    feeAmount: string;
  }) {
    this.assertPublicKey(params.sourcePublicKey);
    this.assertPublicKey(params.destination);
    this.assertPublicKey(params.feeAddress);
    this.assertAmount(params.amount);
    this.assertAmount(params.feeAmount);

    const usdc = this.getUsdcAsset();

    const account = await this.server.loadAccount(params.sourcePublicKey);

    const tx = new TransactionBuilder(account, {
      fee: String(BASE_FEE),
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        Operation.payment({
          destination: params.destination,
          asset: usdc,
          amount: params.amount,
        }),
      )
      .addOperation(
        Operation.payment({
          destination: params.feeAddress,
          asset: usdc,
          amount: params.feeAmount,
        }),
      )
      .setTimeout(180)
      .build();

    return {
      xdr: tx.toXDR(),
      networkPassphrase: this.networkPassphrase,
    };
  }

  /**
   * Recibe un XDR ya firmado por el cliente y lo envía a Stellar.
   * Traduce errores de Horizon a mensajes claros.
   */
  async submitSignedXdr(signedXdr: string) {
    let tx;
    try {
      tx = TransactionBuilder.fromXDR(signedXdr, this.networkPassphrase);
    } catch {
      throw new BadRequestException('signedXdr inválido o mal formado.');
    }

    try {
      const res = await this.server.submitTransaction(tx as any);
      return {
        hash: res.hash,
        ledger: res.ledger,
        successful: res.successful,
      };
    } catch (err: any) {
      throw new BadRequestException(this.describeHorizonError(err));
    }
  }

  /** Construye el Asset USDC a partir del issuer configurado. */
  private getUsdcAsset() {
    const issuer = this.config.get<string>('TRUSTLESS_WORK_USDC_ISSUER');
    if (!issuer) {
      throw new BadRequestException(
        'Falta TRUSTLESS_WORK_USDC_ISSUER para operar con USDC.',
      );
    }
    this.assertPublicKey(issuer);
    return new Asset('USDC', issuer);
  }

  /** Extrae un mensaje legible de los errores de Horizon. */
  private describeHorizonError(err: any): string {
    const codes = err?.response?.data?.extras?.result_codes;
    const txCode = codes?.transaction;
    const opCodes: string[] = codes?.operations ?? [];

    if (opCodes.includes('op_no_trust')) {
      return 'El destinatario o el colector no tiene trustline para USDC.';
    }
    if (opCodes.includes('op_underfunded') || txCode === 'tx_insufficient_balance') {
      return 'Fondos insuficientes para cubrir el monto y el fee.';
    }
    if (txCode === 'tx_bad_auth' || txCode === 'tx_bad_auth_extra') {
      return 'La transacción no está firmada correctamente.';
    }
    if (txCode === 'tx_too_late' || txCode === 'tx_too_early') {
      return 'La transacción expiró. Vuelve a prepararla y firmarla.';
    }
    if (txCode) {
      return `Stellar rechazó la transacción (${txCode}).`;
    }
    return 'No se pudo enviar la transacción a Stellar.';
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