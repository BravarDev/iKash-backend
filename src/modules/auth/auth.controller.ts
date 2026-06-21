import { Controller, Post, Body } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AppException, ErrorCode } from '../../common/errors';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * Endpoint for wallet-based login.
   * Emits a temporary JWT based on the public key.
   */
  @Post('login')
  async login(@Body('publicKey') publicKey: string) {
    if (!publicKey) {
      throw new AppException(ErrorCode.MISSING_PUBLIC_KEY, 'Public key is required');
    }
    return this.authService.login(publicKey);
  }
}
