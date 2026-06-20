import {
  Controller,
  Post,
  Body,
  Headers,
  HttpCode,
  HttpStatus,
  Req,
  Logger,
  Get,
  Query,
  type RawBodyRequest,
} from '@nestjs/common';
import type { Request } from 'express';
import { KycService } from './kyc.service';
import * as crypto from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { AppException, ErrorCode } from '../../common/errors';

@Controller('kyc')
export class KycController {
  private readonly webhookSecret = process.env.DIDIT_WEBHOOK_SECRET;
  private readonly logger = new Logger(KycController.name);

  constructor(
    private readonly kycService: KycService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('start')
  async startKyc(@Body('userId') userId: string) {
    if (!userId) {
      throw new AppException(
        ErrorCode.MISSING_USER_ID,
        'User ID is required',
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.kycService.initializeSession(userId);
  }

  /**
   * Lightweight polling endpoint — frontend calls this after returning from
   * Didit to get the latest kycStatus without waiting for the webhook.
   */
  @Get('status')
  async getKycStatus(@Query('userId') userId: string) {
    if (!userId) {
      throw new AppException(
        ErrorCode.MISSING_USER_ID,
        'User ID is required',
        HttpStatus.BAD_REQUEST,
      );
    }
    const user = await this.prisma.appUser.findUnique({
      where: { userId },
      select: { kycStatus: true, kycUpdatedAt: true },
    });
    if (!user) {
      return { kycStatus: 'pending', kycUpdatedAt: null };
    }
    return user;
  }

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Headers('x-signature-v2') signatureV2: string,
    @Headers('x-signature') signatureV1: string,
    @Headers('x-signature-simple') signatureSimple: string,
    @Req() req: RawBodyRequest<Request>,
    @Body() payload: any,
  ) {
    this.logger.log(
      `[WEBHOOK] Received webhook. Headers: x-signature-v2=${!!signatureV2}, x-signature=${!!signatureV1}, x-signature-simple=${!!signatureSimple}`,
    );

    if (!this.webhookSecret) {
      this.logger.error('[WEBHOOK] DIDIT_WEBHOOK_SECRET is not configured');
      throw new AppException(
        ErrorCode.KYC_WEBHOOK_SECRET_MISSING,
        'DIDIT_WEBHOOK_SECRET is not configured',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    const rawBodyBuffer = req.rawBody;
    if (!rawBodyBuffer) {
      this.logger.error('[WEBHOOK] Missing raw HTTP body');
      throw new AppException(
        ErrorCode.KYC_WEBHOOK_MISSING_BODY,
        'Missing raw HTTP body. Ensure { rawBody: true } is set in main.ts.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    // Try V2 signature first, then V1
    const sigToVerify = signatureV2 || signatureV1;
    if (sigToVerify) {
      const expectedSignature = crypto
        .createHmac('sha256', this.webhookSecret)
        .update(rawBodyBuffer)
        .digest('hex');

      if (sigToVerify !== expectedSignature) {
        this.logger.warn(
          `[WEBHOOK] Signature mismatch. Expected=${expectedSignature.slice(0, 16)}... Got=${sigToVerify.slice(0, 16)}...`,
        );
        throw new AppException(
          ErrorCode.KYC_WEBHOOK_INVALID_SIGNATURE,
          'Invalid webhook signature',
          HttpStatus.UNAUTHORIZED,
        );
      }
      this.logger.log('[WEBHOOK] Signature verified ✅');
    } else if (signatureSimple) {
      const sessionId = payload?.session_id || '';
      const status = payload?.status || '';
      const webhookType = payload?.webhook_type || '';
      const simplePayload = `:${sessionId}:${status}:${webhookType}`;
      const expectedSimple = crypto
        .createHmac('sha256', this.webhookSecret)
        .update(simplePayload)
        .digest('hex');

      if (signatureSimple !== expectedSimple) {
        this.logger.warn('[WEBHOOK] Simple signature mismatch');
        throw new AppException(
          ErrorCode.KYC_WEBHOOK_INVALID_SIGNATURE,
          'Invalid webhook signature',
          HttpStatus.UNAUTHORIZED,
        );
      }
      this.logger.log('[WEBHOOK] Simple signature verified ✅');
    } else {
      this.logger.warn('[WEBHOOK] No signature header found');
      throw new AppException(
        ErrorCode.KYC_WEBHOOK_INVALID_SIGNATURE,
        'Missing X-Signature header',
        HttpStatus.UNAUTHORIZED,
      );
    }

    await this.kycService.processWebhookEvent(payload);

    return { received: true };
  }
}
