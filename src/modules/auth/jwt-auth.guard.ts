import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  canActivate(context: ExecutionContext) {
    if (process.env.MOCK_PROFILE_UPLOAD === 'true') {
      const request = context.switchToHttp().getRequest();
      request.user = {
        userId: request.params?.id ?? 'mock-user',
        publicKey: 'mock-public-key',
      };
      return true;
    }

    return super.canActivate(context);
  }
}
