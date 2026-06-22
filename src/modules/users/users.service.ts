import { Injectable } from '@nestjs/common';
import { PaginationDto } from '../../common/pagination.dto';
import { CreateUserDto } from './dto/create-users.dto';
import { UpdateUserDto } from './dto/update-users.dto';
import { UsersRepository } from './users.repository';
import { PrismaService } from '../../../prisma/prisma.service';
import { SetupAccountDto } from './dto/setup-account.dto';
import { AuthService } from '../auth/auth.service';
import { AppException, ErrorCode } from '../../common/errors';

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
      throw new AppException(ErrorCode.MISSING_EMAIL, 'Email is required');
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      throw new AppException(ErrorCode.INVALID_EMAIL, 'Invalid email format');
    }

    return this.prisma.waitlist.upsert({
      where: { email },
      update: {},
      create: { email },
    });
  }

  async isAliasAvailable(alias: string) {
    const available = await this.repo.isAliasAvailable(alias);
    return { available };
  }

  async setupAccount(userId: string, dto: SetupAccountDto) {
    const {
      bankName,
      accountHolderName,
      accountNumber,
      providerId,
      accountIdentifier,
      identificationNumber,
      beneficiaryName,
      description,
      ...profileData
    } = dto;

    const updatedUser = await this.repo.update(userId, {
      ...profileData,
      pendingAccountInfo: false,
    });

    if (providerId && accountIdentifier) {
      const provider = await this.prisma.payment_provider.findUnique({
        where: { provider_id: providerId },
      });

      if (!provider) {
        throw new AppException(
          ErrorCode.PAYMENT_PROVIDER_NOT_FOUND,
          'Payment provider not found',
        );
      }

      await this.prisma.paymentMethod.create({
        data: {
          userId,
          providerId,
          type: provider.type,
          accountIdentifier,
          identificationNumber,
          beneficiaryName,
          description,
        },
      });
    }

    const { access_token } = await this.authService.finalizeSetup(
      userId,
      updatedUser.publicKey,
    );

    return { user: updatedUser, access_token };
  }

  async create(dto: CreateUserDto) {
    const exists = await this.repo.findByPublicKey(dto.publicKey);
    if (exists) {
      throw new AppException(
        ErrorCode.USER_ALREADY_EXISTS,
        'A user with this public key already exists',
      );
    }
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
    if (!item) {
      throw new AppException(ErrorCode.USER_NOT_FOUND, `User ${id} not found`);
    }
    return item;
  }

  async update(id: string, dto: UpdateUserDto, callerUserId?: string) {
    if (callerUserId && callerUserId !== id) {
      throw new AppException(
        ErrorCode.UNAUTHORIZED_ACTION,
        'You can only update your own profile.',
      );
    }

    if (dto.alias) {
      const user = await this.repo.findById(id);
      if (!user) {
        throw new AppException(ErrorCode.USER_NOT_FOUND, `User ${id} not found`);
      }
      if (user.alias !== dto.alias) {
        const isAvailable = await this.repo.isAliasAvailable(dto.alias);
        if (!isAvailable) {
          throw new AppException(ErrorCode.ALIAS_TAKEN, 'Alias is already taken');
        }
      }
    }

    const data: any = { ...dto };
    if (dto.kycStatus) data.kycUpdatedAt = new Date();
    return this.repo.update(id, data);
  }

  remove(id: string) {
    return this.repo.delete(id);
  }
}
