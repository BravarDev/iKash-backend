import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class KycVerifiedGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const userPayload = request.user;

    if (!userPayload || !userPayload.publicKey) {
      throw new ForbiddenException('Authentication required');
    }

    const user = await this.prisma.appUser.findUnique({
      where: { publicKey: userPayload.publicKey },
      select: { kycStatus: true },
    });

    if (!user || user.kycStatus !== 'approved') {
      throw new ForbiddenException('KYC verification required to perform this action');
    }

    return true;
  }
}
