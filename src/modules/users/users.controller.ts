import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { PaginationDto } from '../../common/pagination.dto';
import type { AuthenticatedRequest } from '../../lib/types/auth';
import { CreateUserDto } from './dto/create-users.dto';
import { UpdateUserDto } from './dto/update-users.dto';
import { ValidateAliasDto } from './dto/validate-alias.dto';
import { UsersService } from './users.service';
import { SetupAccountDto } from './dto/setup-account.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';

@Controller('users')
export class UsersController {
  constructor(private readonly service: UsersService) {}

  @Get('account')
  getOrCreate(@Query('publicKey') publicKey: string) {
    return this.service.getOrCreateAccount(publicKey);
  }

  @Post('early-register')
  earlyRegister(@Body('email') email: string) {
    return this.service.earlyRegister(email);
  }

  /**
   * Validates the format and availability of a user alias.
   *
   * The alias is first validated at the DTO layer (`ValidateAliasDto`) — it must
   * be lowercase, contain no spaces, and only include characters matching
   * `/^[a-z0-9.!_]+$/`. If the format check passes, the service queries the
   * database and returns `{ available: boolean }`.
   *
   * @returns `{ available: true }` if the alias is free, `{ available: false }` if taken.
   * @throws `400 Bad Request` when the alias fails format validation (invalid chars, uppercase, spaces, too long).
   *
   * @see docs/entrypoint-dto-validations.md for the full scenario matrix.
   */
  @UseGuards(JwtAuthGuard)
  @Get('validate-alias')
  checkAlias(@Query() query: ValidateAliasDto) {
    return this.service.isAliasAvailable(query.alias);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/setup')
  setup(@Param('id') id: string, @Body() dto: SetupAccountDto) {
    return this.service.setupAccount(id, dto);
  }

  @Post()
  create(@Body() dto: CreateUserDto) {
    return this.service.create(dto);
  }

  @Get()
  list(@Query() p: PaginationDto) {
    return this.service.list(p);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.update(id, dto, req.user?.userId ?? req.user?.id);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id/profile-picture')
  @UseInterceptors(FileInterceptor('profileImage'))
  uploadProfilePicture(
    @Param('id') id: string,
    @Req() req: Request & { user: { userId: string } },
    @Body('userSnapshot') userSnapshot?: string,
    @UploadedFile() file?: {
      originalname: string;
      mimetype: string;
      size: number;
    },
  ) {
    if (req.user?.userId !== id) {
      throw new ForbiddenException('You can only upload a profile picture for your own account');
    }

    if (!file) {
      throw new BadRequestException('Profile image file is required');
    }

    const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException('Only JPEG, PNG, and WEBP images are allowed');
    }

    const maxFileSize = 5 * 1024 * 1024;
    if (file.size > maxFileSize) {
      throw new BadRequestException('Profile image must be 5MB or smaller');
    }

    let parsedSnapshot: Record<string, unknown> | undefined;
    if (userSnapshot) {
      try {
        parsedSnapshot = JSON.parse(userSnapshot) as Record<string, unknown>;
      } catch {
        throw new BadRequestException('userSnapshot must be valid JSON');
      }
    }

    return this.service.uploadProfilePicture(id, file, parsedSnapshot);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
