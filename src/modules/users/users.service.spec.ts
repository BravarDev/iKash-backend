import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from '../auth/auth.service';
import { UsersRepository } from './users.repository';
import { UsersService } from './users.service';
import { PrismaService } from '../../../prisma/prisma.service';

describe('UsersService', () => {
  let service: UsersService;
  let repo: {
    update: jest.Mock<Promise<unknown>, [string, Record<string, unknown>]>;
  };

  beforeEach(async () => {
    repo = {
      update: jest.fn<Promise<unknown>, [string, Record<string, unknown>]>(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: UsersRepository, useValue: repo },
        { provide: PrismaService, useValue: {} },
        { provide: AuthService, useValue: {} },
      ],
    }).compile();

    service = module.get(UsersService);
  });

  it('updates the user when the authenticated user owns the resource', async () => {
    const updatedUser = { userId: 'user-1', alias: 'new-alias' };
    repo.update.mockResolvedValue(updatedUser);

    await expect(
      service.update('user-1', { alias: 'new-alias' }, 'user-1'),
    ).resolves.toEqual(updatedUser);

    expect(repo.update).toHaveBeenCalledWith('user-1', { alias: 'new-alias' });
  });

  it('sets kycUpdatedAt only after ownership is validated', async () => {
    repo.update.mockResolvedValue({ userId: 'user-1', kycStatus: 'approved' });

    await service.update('user-1', { kycStatus: 'approved' }, 'user-1');

    const [userId, data] = repo.update.mock.calls[0];

    expect(userId).toBe('user-1');
    expect(data.kycStatus).toBe('approved');
    expect(data.kycUpdatedAt).toBeInstanceOf(Date);
  });

  it('rejects attempts to update another user resource', () => {
    expect((): void => {
      service.update('user-2', { alias: 'taken' }, 'user-1');
    }).toThrow(ForbiddenException);

    expect(repo.update).not.toHaveBeenCalled();
  });

  it('rejects update attempts without an authenticated user id', () => {
    expect((): void => {
      service.update('user-1', { alias: 'new-alias' });
    }).toThrow(ForbiddenException);

    expect(repo.update).not.toHaveBeenCalled();
  });
});
