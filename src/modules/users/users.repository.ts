import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { BaseRepository } from '../../common/base.repository';

@Injectable()
export class UsersRepository extends BaseRepository {
  constructor(private readonly prisma: PrismaService) {
    super(prisma.appUser, 'userId');
  }

  // ✅ ESTE método existe SOLO aquí, por eso el service debe inyectar UsersRepository
  findByPublicKey(publicKey: string) {
    return this.prisma.appUser.findUnique({ 
      where: { publicKey },
      include: {
        paymentMethods: {
          include: {
            payment_provider: true
          }
        }
      }
    });
  }

  async findOrCreateByPublicKey(publicKey: string) {
    const existing = await this.findByPublicKey(publicKey);
    if (existing) return existing;
    return this.create({ publicKey, pendingAccountInfo: true });
  }

  async isAliasAvailable(alias: string): Promise<boolean> {
    const found = await this.prisma.appUser.findUnique({ where: { alias } });
    return found === null;
  }
}