import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PaginationDto } from '../../common/pagination.dto';
import { CreateUserDto } from './dto/create-users.dto';
import { UpdateUserDto } from './dto/update-users.dto';
import { UsersRepository } from './users.repository';
import { PrismaService } from '../../../prisma/prisma.service';
import { SetupAccountDto } from './dto/setup-account.dto';
import { AuthService } from '../auth/auth.service';

@Injectable()
export class UsersService {
  constructor(
    private readonly repo: UsersRepository,
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
  ) {}

  async getOrCreateAccount(publicKey: string) {
    return this.repo.findOrCreateByPublicKey(publicKey);
  }

  async earlyRegister(email: string) {
    if (!email) {
      throw new BadRequestException('Email is required');
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      throw new BadRequestException('Formato de correo electrónico inválido');
    }

    return this.prisma.waitlist.upsert({
      where: { email },
      update: {}, // idempotent, si existe no hace nada
      create: { email },
    });
  }

  async isAliasAvailable(alias: string) {
    const available = await this.repo.isAliasAvailable(alias);
    return { available };
  }

  async setupAccount(userId: string, dto: SetupAccountDto) {
    const { 
      bankName, accountHolderName, accountNumber, 
      providerId, accountIdentifier, identificationNumber, beneficiaryName, description,
      ...profileData 
    } = dto;
    
    // Update user profile + set pendingAccountInfo = false
    const updatedUser = await this.repo.update(userId, { 
      ...profileData, 
      pendingAccountInfo: false 
    });

    if (providerId && accountIdentifier) {
      const provider = await this.prisma.payment_provider.findUnique({
        where: { provider_id: providerId }
      });

      if (!provider) {
        throw new NotFoundException('Payment provider not found');
      }

      await this.prisma.paymentMethod.create({
        data: {
          userId,
          providerId,
          type: provider.type,
          accountIdentifier: accountIdentifier,
          identificationNumber: identificationNumber,
          beneficiaryName: beneficiaryName,
          description: description,
        },
      });
    }

    // Generate new JWT
    const { access_token } = await this.authService.finalizeSetup(userId, updatedUser.publicKey);

    return {
      user: updatedUser,
      access_token,
    };
  }

  async create(dto: CreateUserDto) {
    const exists = await this.repo.findByPublicKey(dto.publicKey);
    if (exists) throw new BadRequestException('public_key ya existe');
    return this.repo.create(dto);
  }

  list(p: PaginationDto) {
    return this.repo.findMany({
      skip: p.skip,
      take: p.take,
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(id: string) {
    const item = await this.repo.findById(id);
    if (!item) throw new NotFoundException('User no encontrado');
    return item;
  }

  update(id: string, dto: UpdateUserDto) {
    const data: any = { ...dto };
    if (dto.kycStatus) data.kycUpdatedAt = new Date();
    return this.repo.update(id, data);
  }

  remove(id: string) {
    return this.repo.delete(id);
  }
}