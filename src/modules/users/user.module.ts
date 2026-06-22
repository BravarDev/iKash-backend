import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersRepository } from './users.repository';
import { UsersService } from './users.service';
import { AuthModule } from '../auth/auth.module';
import { FileStorageService } from './file-storage/file-storage.service';
import { MockFileStorageService } from './file-storage/mock-file-storage.service';

@Module({
  imports: [AuthModule],
  controllers: [UsersController],
  providers: [
    UsersService,
    UsersRepository,
    {
      provide: FileStorageService,
      useClass: MockFileStorageService,
    },
  ],
  exports: [UsersService, UsersRepository],
})
export class UsersModule {}
