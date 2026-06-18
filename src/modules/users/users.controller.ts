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
import { CreateUserDto } from './dto/create-users.dto';
import { UpdateUserDto } from './dto/update-users.dto';
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

  @Get('available-username')
  checkAlias(@Query('alias') alias: string) {
    return this.service.isAliasAvailable(alias);
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

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.service.update(id, dto);
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
