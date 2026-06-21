import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SendService } from './send.service';
import { PrepareSendDto } from './dto/prepare-send.dto';
import { SubmitSendDto } from './dto/submit-send.dto';

@UseGuards(JwtAuthGuard)
@Controller('send')
export class SendController {
  constructor(private readonly service: SendService) {}

  // Resolves an alias/address and returns recipient info for confirmation.
  @Get('resolve')
  resolve(@Query('recipient') recipient: string) {
    if (!recipient) {
      throw new BadRequestException('The "recipient" parameter is missing.');
    }
    return this.service.resolveRecipient(recipient);
  }

  // Validates, calculates the 0.3% fee and returns the unsigned USDC transaction.
  @Post('prepare')
  prepare(@Request() req: any, @Body() dto: PrepareSendDto) {
    return this.service.prepare(req.user.publicKey, dto.recipient, dto.amount);
  }

  // Receives the XDR signed by the frontend and submits it to Stellar.
  @Post('submit')
  submit(@Body() dto: SubmitSendDto) {
    return this.service.submit(dto.signedXdr);
  }
}
