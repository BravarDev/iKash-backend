import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PaginationDto } from '../../common/pagination.dto';
import { CreateUserDto } from './dto/create-users.dto';
import { UpdateUserDto } from './dto/update-users.dto';
import { UsersRepository } from './users.repository';
import { PrismaService } from '../../../prisma/prisma.service';
import { SetupAccountDto } from './dto/setup-account.dto';
import { AuthService } from '../auth/auth.service';
import { FileStorageService } from './file-storage/file-storage.service';

@Injectable()
export class UsersService {
  constructor(
    private readonly repo: UsersRepository,
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
    private readonly fileStorageService: FileStorageService,
  ) {}

  async getOrCreateAccount(publicKey: string) {
    return this.repo.findOrCreateByPublicKey(publicKey);
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

    // 1. Create Legacy PaymentMethod if data provided
    if (bankName || accountNumber) {
      await this.prisma.paymentMethod.create({
        data: {
          userId,
          bankName: bankName ?? 'Unknown',
          accountDetails: `${accountHolderName ?? ''} | ${accountNumber ?? ''}`,
        },
      });
    }

    // 2. Create New payment_method (snake_case) if providerId provided
    if (providerId && accountIdentifier) {
      const provider = await this.prisma.payment_provider.findUnique({
        where: { provider_id: providerId }
      });

      if (!provider) {
        throw new NotFoundException('Payment provider not found');
      }

      await this.prisma.payment_method.create({
        data: {
          user_id: userId,
          provider_id: providerId,
          type: provider.type,
          account_identifier: accountIdentifier,
          identification_number: identificationNumber,
          beneficiary_name: beneficiaryName,
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

  async uploadProfilePicture(id: string, file: {
    originalname: string;
    mimetype: string;
    size: number;
  }, userSnapshot?: Record<string, unknown>) {
    if (process.env.MOCK_PROFILE_UPLOAD === 'true') {
      const uploadedFile = await this.fileStorageService.uploadFile(file);
      return {
        ...(userSnapshot ?? {}),
        userId: id,
        profileImageUrl: uploadedFile.url,
      };
    }

    const user = await this.repo.findById(id);
    if (!user) throw new NotFoundException('User no encontrado');

    const uploadedFile = await this.fileStorageService.uploadFile(file);
    return this.repo.update(id, {
      profileImageUrl: uploadedFile.url,
    });
  }

  remove(id: string) {
    return this.repo.delete(id);
  }
}
