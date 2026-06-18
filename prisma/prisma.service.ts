import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  async onModuleInit() {
    if (process.env.MOCK_PROFILE_UPLOAD === 'true') {
      return;
    }

    await this.$connect();
  }
}
