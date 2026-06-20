import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { PaginationDto } from '../../common/pagination.dto';
import type { AuthenticatedRequest } from '../../lib/types/auth';
import { CreateUserDto } from './dto/create-users.dto';
import { UpdateUserDto } from './dto/update-users.dto';
import { UsersService } from './users.service';
import { SetupAccountDto } from './dto/setup-account.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

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

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.update(id, dto, req.user?.userId ?? req.user?.id);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
